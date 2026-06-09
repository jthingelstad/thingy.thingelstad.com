# thingy_bridge — project memory

Thingy's Discord bridge is a Supporting Member presence, not a second Thingy
chat app.

## Current Shape

- `/thingy verify` starts a Discord-bound verification flow.
- `/thingy confirm <code>` redeems the code from `thingy.thingelstad.com/discord/`
  and grants the Supporting Member role.
- Thingy answers only explicit mentions in the configured `#general` channel.
- Librarian/Studio owns identity, profile storage, entitlements, retrieval,
  answer generation, and operator visibility.

## Important Boundaries

- Do not reintroduce Discord-local chat sessions, source scopes, request
  tracking, reaction feedback, or token minting.
- Do not call `/chat` with Discord user tokens. Use the bridge-secret
  `/discord/mention` endpoint so Discord activity stays separate from private
  web conversations.
- Normal subscribers do not get Discord linking. Paid, gifted, tagged
  Supporting Members, and owner accounts do.
- The bridge can grant or remove roles, but Studio remains authoritative for
  whether a Discord user is linked and currently entitled.

## Useful Files

- `commands.py`: `/thingy verify` and `/thingy confirm`.
- `personas/thingy.py`: mention-only `#general` behavior.
- `tools/thingy_client.py`: Librarian API calls for linking and mentions.
- `tools/startup.py`: channel, guild, and role readiness checks.
- `tools/db.py`: local job locks only.
