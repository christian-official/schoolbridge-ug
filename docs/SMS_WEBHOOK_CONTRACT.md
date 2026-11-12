# SchoolBridge SMS webhook

SchoolBridge can send parent/teacher verification codes through an administrator-configured HTTPS webhook. No applicant can provide or change the destination phone number; the backend selects it from a school-verified guardian or staff record.

Configure these server-side environment variables:

- `SCHOOLBRIDGE_SMS_WEBHOOK_URL`: HTTPS endpoint that accepts a JSON POST.
- `SCHOOLBRIDGE_SMS_WEBHOOK_TOKEN`: optional bearer token.

Request body:

```json
{
  "to": "+2567XXXXXXXX",
  "message": "Your SchoolBridge verification code is 123456."
}
```

The endpoint must return a 2xx HTTP status after accepting the message. If the URL is absent, invalid, times out, or returns an error, SchoolBridge does not pretend that a code was sent; the claim is routed to school review instead.

The webhook URL and token must be configured by the deployment administrator, never supplied by a school user or registration applicant.
