# SchoolBridge desktop LAN access

LAN access is disabled by default. Keep the desktop frontend on its loopback API at
http://127.0.0.1:8080. The separate LAN API listener must use HTTPS on the
configured private IPv4 address and a separate port (default 8443).

## Certificate requirements

Set these values in the installed .env only after a certificate has been
provisioned for the host's exact private IPv4 address. The current desktop
LAN configuration binds and allows the IP address only; client devices must
connect using that same IP address (not a DNS alias):

    SCHOOLBRIDGE_LAN_ENABLED=true
    SCHOOLBRIDGE_LAN_BIND_IP=192.168.1.20
    SCHOOLBRIDGE_LAN_PORT=8443
    SCHOOLBRIDGE_LAN_CERT_FILE=C:\SchoolBridgeSecrets\lan-cert.pem
    SCHOOLBRIDGE_LAN_KEY_FILE=C:\SchoolBridgeSecrets\lan-key.pem

Use the actual private IPv4 address assigned to the host computer. The
certificate must contain that address (or the DNS name used by clients) in its
Subject Alternative Name. It must chain to a certificate authority trusted by
every client device. Do not ask staff to bypass certificate warnings. Keep the
private key outside the installation/USB directory, restrict its NTFS
permissions to the SchoolBridge operator account, and never include it in a
USB package or general staff backup.

The backend verifies that both certificate files exist, are separate, and are
outside the installation directory. Uvicorn validates the certificate/key pair
when the HTTPS listener starts. File existence alone does not prove client trust.

## Windows Firewall

Run elevated PowerShell on the host after configuring the application and
certificate. Replace the sample address with the host's actual private Wi-Fi
IPv4 address:

    .\configure-lan-firewall.ps1 -BindAddress 192.168.1.20 -Port 8443

The script refuses public/loopback addresses, requires the selected interface
to be classified as a Private network, and creates one inbound rule limited to:

- the installed SchoolBridge Python runtime executable;
- the configured local IPv4 address and TCP port;
- the Windows Private firewall profile; and
- LocalSubnet as the remote address range.

It does not open port 8080, change the network profile, disable the firewall,
or expose the listener to public networks. To remove the rule:

    .\configure-lan-firewall.ps1 -Disable

## Current security boundary

The LAN listener is opt-in and uses a separate HTTPS process while the desktop
frontend remains loopback-only. Both processes use the same local SQLite file.
SQLite WAL mode and a bounded busy timeout support concurrent readers/writers,
but concurrent LAN load and backup/restore behavior still require integration
testing on the installed Windows application.

User authentication and per-user device registration/revocation checks remain
required. Device registration is intentionally free and self-service: a
signed-in user can register their own device without administrator approval.
Registration does not grant access to another user's records; sync endpoints
must continue enforcing the authenticated account's scope and active-device
status.

Before production LAN use, verify certificate trust from a second device,
firewall scope on the actual school router, account permissions, device
revocation, and database backup/restore while both listeners are running.
