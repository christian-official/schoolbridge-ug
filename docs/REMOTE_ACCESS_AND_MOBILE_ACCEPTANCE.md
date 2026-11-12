# SchoolBridge remote access decision and mobile acceptance

## Default deployment: school LAN

SchoolBridge remains local-first. For normal school use, keep the database and application on the school's host and use the opt-in LAN HTTPS listener for phones and staff devices on the trusted school network.

- Use the installation-specific LAN certificate and install only its public root certificate on authorised client devices.
- Keep the LAN firewall rule restricted to the Private profile and LocalSubnet.
- Generate the reusable school QR from the reachable HTTPS LAN address.
- QR identifies the installation; it does not authenticate a user or grant permissions.
- Each parent/staff member signs in with their own account and redeems their own single-use invitation.
- Do not enable public internet access merely to make the PWA installable.

This path supports mobile access while keeping student records inside the school's local network. PWA installation requires a secure browser context, which the configured LAN HTTPS listener provides after client trust is established.

## Public HTTPS hostname: decision

A stable public hostname is optional and must not be silently enabled by the installer or QR workflow. Public routing makes the school application reachable from outside the school network, so it requires an explicit school-authorised deployment decision and a separate security review.

Current options and trade-offs:

- **School-controlled domain with a managed HTTPS reverse proxy/tunnel:** preferred for a school that has formally approved remote access. The school controls the hostname and account, and can define access, monitoring, retention and incident-response arrangements. This still requires a security review before production use.
- **Tailscale Funnel:** provides a stable HTTPS *.ts.net hostname and is listed as available on all Tailscale plans. However, it publishes the selected local service to the public internet; anyone with the URL can reach the service's public login surface. It is suitable only for a controlled demonstration or evaluation until SchoolBridge's public-edge controls and the school's data-protection requirements have been reviewed. The school host must run the Tailscale client and remain online.
- **Cloudflare Quick Tunnel:** creates a random *.trycloudflare.com address that changes when the process is restarted and is documented for testing/development, not production. Do not use it as the school's reusable QR destination.
- **Cloudflare named Tunnel:** supports a persistent hostname, but publishing an application requires a Cloudflare account and a domain on Cloudflare. It is not a zero-cost hostname supplied automatically by SchoolBridge.

SchoolBridge therefore does not automatically create a public tunnel or claim that a free temporary URL is a permanent school address. Until a school explicitly selects and configures an approved public hostname, use the LAN HTTPS route described in DESKTOP_LAN_ACCESS.md.

References:
- Tailscale Funnel: https://tailscale.com/docs/features/tailscale-funnel
- Cloudflare Tunnel fundamentals: https://developers.cloudflare.com/tunnel/concepts/
- Cloudflare Quick Tunnels: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- Cloudflare Tunnel setup prerequisites: https://developers.cloudflare.com/tunnel/get-started/

## Mobile acceptance checklist

Run this checklist on the actual school host and representative phones before calling Task 1.10 production-ready. Use test accounts and synthetic student data only.

### Android (Chrome)

1. Connect the phone to the same trusted school Wi-Fi as the host.
2. Open the school's LAN HTTPS address and confirm there is no browser certificate warning.
3. Scan the reusable QR and confirm the displayed school name is the intended installation.
4. Confirm a QR for another installation is rejected and does not allow sign-in.
5. Sign in with a test parent/staff account.
6. Redeem an invitation issued for that exact account; confirm the device appears in Device Management.
7. Try the same invitation again; confirm replay is rejected.
8. Install from the browser's install/Add to Home Screen prompt and launch the installed app.
9. Update the web app in a test release; confirm the update prompt activates the new shell without leaving the app stuck on an old version.
10. Revoke the test device; confirm it can no longer use protected device operations.

### iPhone/iPad (Safari)

1. Connect the device to the same trusted school Wi-Fi.
2. Open the LAN HTTPS address in Safari and confirm there is no certificate warning.
3. Scan the reusable QR and verify the school identity.
4. Sign in with a test account and redeem its invitation once.
5. Use Share → Add to Home Screen, launch the installed app, and confirm login/navigation work.
6. Repeat the update and device-revocation checks above.

### Offline and recovery boundaries

- Confirm the app shell can reopen while the host is temporarily unreachable.
- Confirm protected API requests do not appear to succeed from stale cached responses.
- Do not treat the current service-worker shell cache as offline access to school records. API responses and non-GET requests are deliberately not cached.
- Confirm device revocation and invitation redemption are enforced again when the server is reachable.
- Separately test backup/restore while the LAN listener is in use before production rollout.

Record device model, OS/browser version, test date, host address, certificate result, install result, invitation result, update result and revocation result. Do not record real student details or invitation tokens in the test report.

## Completion gate

Task 1.10 is not complete until:

- all CI jobs pass on the final Task 1.10 commit;
- Android and iOS acceptance checks are completed on real devices;
- one-time invitation issue, redemption, replay rejection and revocation are verified end-to-end;
- QR school-identity verification and mismatch rejection are verified end-to-end;
- offline shell behaviour is verified without implying that all school records are offline-capable; and
- the school has explicitly selected LAN-only or an approved public HTTPS hostname.

No public tunnel, external hosting account, DNS record or school-data exposure is created by this documentation change.
