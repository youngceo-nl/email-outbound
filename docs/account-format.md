# Account Credential Format

## Standard Format

```
email@provider.com
**Instagram**: [username] | Pass - [instagram_password]
[Apify]
[Email/Outlook] Pass [(site)] - [email_password]
-----------------------------------------------------
```

- **Instagram** is always bolded
- **Apify** line is included only if the account is registered on Apify
- The email password label depends on the provider:
  - Outlook accounts → `Outlook Pass`
  - Other providers → `Email Pass (site.com)` where site is where you access the inbox (e.g. `firstmail.ltd`)
  - If no site known, just `Email Pass`

## Instagram Password

- All accounts in a batch share the same Instagram password
- The batch password is stated at the top of the raw data (e.g. `ser20*` or `Saif@1234`)

## Instagram Status Notes

When an account has an Instagram issue instead of a username, note it inline:

- `**Instagram**: expelled from instagram`
- `**Instagram**: needs safety bypassing`

No password is shown for these since the account is inaccessible.

## Unknown Usernames

If the Instagram username wasn't provided in the source data, use `[username]` as a placeholder.

## Examples

### Outlook batch (Apify, known usernames)
```
hayessantiagogdve@outlook.com
**Instagram**: hayessantiagogdve2026 | Pass - Saif@1234
Apify
Outlook Pass - 9#pB$3vK!7xM4bQf
-----------------------------------------------------
jalenyoungdjqy@outlook.com
**Instagram**: jalenyoungdjqy2026 | Pass - Saif@1234
Outlook Pass - 4!kM#9vR$2pQ7xBf
-----------------------------------------------------
```

### Non-Outlook batch (firstmail.ltd, mixed Instagram status)
```
xkqqshqz@difficilemail.com
**Instagram**: jacquimcova | Pass - ser20*
Email Pass (firstmail.ltd) - 2#tV$7mK!9xB4pQf
-----------------------------------------------------
thesrsxa@difficilemail.com
**Instagram**: expelled from instagram
Email Pass (firstmail.ltd) - kP9#vX2!mQ7$zR4B
-----------------------------------------------------
```
