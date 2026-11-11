import importlib.util
import ipaddress
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.x509.oid import ExtendedKeyUsageOID

MODULE_PATH = Path(__file__).parents[2] / "scripts" / "provision-lan-certificates.py"
SPEC = importlib.util.spec_from_file_location("schoolbridge_lan_certificates", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class LanCertificateProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.secrets = self.root / "secrets"
        self.env = self.root / ".env"
        self.export = self.root / "desktop" / "SchoolBridge-LAN-Root-CA.pem"
        self.env.write_text("SCHOOLBRIDGE_LAN_ENABLED=false\nSCHOOLBRIDGE_PORT=8080\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_provisions_constrained_ca_and_ip_san_server_certificate(self):
        result = MODULE.provision("192.168.1.20", self.secrets, self.env, self.export)
        ca = x509.load_pem_x509_certificate(self.export.read_bytes())
        server = x509.load_pem_x509_certificate(Path(result["server_certificate"]).read_bytes())
        constraints = ca.extensions.get_extension_for_class(x509.BasicConstraints).value
        self.assertTrue(constraints.ca)
        self.assertEqual(constraints.path_length, 0)
        self.assertFalse(server.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
        self.assertEqual(
            server.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress),
            [ipaddress.ip_address("192.168.1.20")],
        )
        self.assertIn(
            ExtendedKeyUsageOID.SERVER_AUTH,
            server.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value,
        )
        self.assertEqual(server.issuer, ca.subject)
        self.assertIn("SCHOOLBRIDGE_LAN_ENABLED=false", self.env.read_text(encoding="utf-8"))
        self.assertIn("SCHOOLBRIDGE_LAN_CERT_FILE=", self.env.read_text(encoding="utf-8"))
        self.assertTrue((self.secrets / MODULE.CA_KEY).exists())

    def test_repeat_provisioning_preserves_ca_and_server_identity(self):
        first = MODULE.provision("10.20.0.5", self.secrets, self.env, self.export)
        ca_before = (self.secrets / MODULE.CA_CERT).read_bytes()
        server_before = Path(first["server_certificate"]).read_bytes()
        second = MODULE.provision("10.20.0.5", self.secrets, self.env, self.export)
        self.assertEqual(ca_before, (self.secrets / MODULE.CA_CERT).read_bytes())
        self.assertEqual(server_before, Path(second["server_certificate"]).read_bytes())

    def test_ip_change_reissues_only_server_certificate(self):
        MODULE.provision("192.168.1.20", self.secrets, self.env, self.export)
        ca_before = (self.secrets / MODULE.CA_CERT).read_bytes()
        MODULE.provision("192.168.1.21", self.secrets, self.env, self.export)
        server = x509.load_pem_x509_certificate((self.secrets / MODULE.SERVER_CERT).read_bytes())
        self.assertEqual(ca_before, (self.secrets / MODULE.CA_CERT).read_bytes())
        self.assertEqual(
            server.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress),
            [ipaddress.ip_address("192.168.1.21")],
        )

    def test_rejects_public_or_non_ipv4_addresses(self):
        for address in ("8.8.8.8", "127.0.0.1", "169.254.1.1", "::1"):
            with self.subTest(address=address), self.assertRaises(ValueError):
                MODULE.provision(address, self.secrets, self.env, self.export)

    def test_refuses_mismatched_existing_ca_pair(self):
        self.secrets.mkdir()
        (self.secrets / MODULE.CA_KEY).write_text("not a private key", encoding="ascii")
        (self.secrets / MODULE.CA_CERT).write_text("not a certificate", encoding="ascii")
        with self.assertRaises(Exception):
            MODULE.provision("192.168.1.20", self.secrets, self.env, self.export)


if __name__ == "__main__":
    unittest.main()
