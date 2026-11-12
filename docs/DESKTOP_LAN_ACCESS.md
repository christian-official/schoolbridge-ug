# SchoolBridge desktop LAN access

LAN access is disabled by default. Keep the desktop frontend on its loopback API at
http://127.0.0.1:8080. The separate LAN API listener uses HTTPS on the configured
private IPv4 address and a separate port (default 8443).

## Provision the host certificate

On the installed host, open an elevated PowerShell window in the USB package folder
and run:

    .\provision-lan-certificates.ps1 -BindAddress 192.168.1.20

Use the actual private Wi-Fi IPv4 address assigned to the host. The provisioner
uses the installed Python runtime and its bundled cryptography dependency. It
creates a per-installation P-256 root CA and an IP-bound P-256 server certificate.
The root CA is constrained to certificate signing; the server certificate has
server-auth usage and the host IP as an IP Subject Alternative Name.

Private keys are stored under
%ProgramData%\SchoolBridge\secrets. The script removes inherited directory ACLs
and grants full access only to the installing Windows account and SYSTEM. The CA
private key never leaves the host. The public root certificate is exported to
the operator's Desktop as SchoolBridge-LAN-Root-CA.pem. The script updates the
installed .env with the host IP and certificate/key paths, but does not enable
LAN access.

The root CA is specific to this installation. Do not replace or copy its private
key. If its five-year lifetime approaches expiry, plan an explicit CA rotation
and reinstall the replacement public root certificate on every client. The
server certificate is renewed when it has 30 days or less remaining, or when
the host IP changes. Keep a protected backup of the CA key and certificate; loss
of the CA key requires a new CA and client re-trust.

## Trust the public root on client devices

Transfer only SchoolBridge-LAN-Root-CA.pem to each authorised device using a
trusted administrative method. Never transfer either private key.

- **Windows:** import the public certificate into the Local Computer
  Trusted Root Certification Authorities store, using an administrator-managed
  certificate deployment process.
- **Android:** install the CA certificate through the device's security
  certificate settings. Android app trust behaviour can vary by OS version and
  application; confirm the actual SchoolBridge client trusts user-installed CAs.
- **iPhone/iPad:** install the CA certificate profile, then enable full trust for
  that root in Certificate Trust Settings. Managed devices should use the
  school's approved device-management process.

Do not bypass browser/app TLS warnings. If a client platform does not permit the
SchoolBridge client to trust this private CA, do not connect that client until a
supported trust method is provided.

## Enable the listener and firewall

Only after the root CA is trusted on intended clients, edit the installed
%ProgramData%\SchoolBridge\.env and set:

    SCHOOLBRIDGE_LAN_ENABLED=true

The provisioner has already set the bind IP and certificate/key paths. Then run
elevated PowerShell from the installed package:

    .\configure-lan-firewall.ps1 -BindAddress 192.168.1.20 -Port 8443

The script refuses public/loopback addresses, requires the selected interface to
be classified as a Private network, and creates one inbound rule limited to the
installed SchoolBridge Python runtime, configured local IPv4 address and TCP
port, the Windows Private firewall profile, and LocalSubnet as the remote range.
It does not open port 8080, change the network profile, disable the firewall, or
expose the listener to public networks.

To remove the rule:

    .\configure-lan-firewall.ps1 -Disable

## School QR access and mobile installation

After the LAN HTTPS listener is enabled and its public root certificate is trusted on the intended phones/tablets:

1. On the host computer, open the LAN HTTPS address in a browser, for example
   `https://192.168.1.20:8443`. Do not use `localhost`, `127.0.0.1`, or
   the loopback desktop window to create the mobile QR code.
2. Sign in as a school administrator and open **Device Management**.
3. Use **School mobile access QR** to display or print the reusable school QR.
   The QR contains only the LAN HTTPS address and the non-secret installation
   identifier. It contains no username, password, invitation token or session.
4. Scan it from a phone connected to the same trusted school network. Confirm
   the displayed school identity before signing in.
5. Staff and parents sign in with their own accounts, then open **Device
   Management** and redeem the one-time invitation issued for that account.
   The invitation is single-use and does not replace the normal sign-in or
   account permissions.
6. Install SchoolBridge from the browser's supported **Add to Home Screen** or
   **Install** prompt. iPhone/iPad users must use Safari's Share → Add to Home
   Screen flow.

The QR generator is available only from a reachable HTTPS browser origin.
It does not create a usable mobile link from localhost or insecure HTTP. If
using a hosted HTTPS deployment instead of the LAN listener, open that hosted
school address before generating the QR. Keep the QR within the intended school
community; anyone who scans it still needs valid account credentials.

## Current security boundary

The LAN listener is opt-in and uses a separate HTTPS process while the desktop
frontend remains loopback-only. Both processes use the same local SQLite file.
SQLite WAL mode and a bounded busy timeout support concurrent readers/writers,
but concurrent LAN load and backup/restore behaviour still require integration
testing on the installed Windows application.

User authentication and per-user device registration/revocation checks remain
required. Device registration is intentionally free and self-service: a signed-in
user can register their own device without administrator approval. Registration
does not grant access to another user's records.

Before production LAN use, verify certificate trust from a second device,
firewall scope on the actual school router, account permissions, device
revocation, and database backup/restore while both listeners are running.
