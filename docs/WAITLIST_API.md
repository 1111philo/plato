# Wait list API

Add people to a plato classroom's wait list from your own form or system. An
admin then invites them from **Admin → Users → Wait List** filter; the invite
email takes them to signup, prefilled with what they sent.

Everything below uses `https://plato.courses`. For another plato deployment,
swap in its URL.

## Two ways to send people in

| | With an API key | Without a key |
| --- | --- | --- |
| Works when the wait list is | open **or** closed | open only |
| Call it from | your **server** | a web page (browser) or a server |
| Use when | you run your own form backend, a CRM, a sign-up sheet sync, … | you just want a form on another site to post straight to plato |

Never put the API key in a web page — anyone could read it from the page
source. A browser form should use the no-key route (and needs the list open).

## Get an API key

1. Sign in as an admin → **Admin → Users** → **Wait List** button.
2. Click **Make a key**. Copy it right away — it starts with `wlk_` and is
   shown **once**. plato stores only a hash, so a lost key can't be recovered.
3. To rotate, click **Make a new key** (the old one stops working
   immediately). **Revoke key** turns key access off entirely.

The same dialog opens or closes the public form ("Show 'Join the wait list'
on the sign-in page"). Closing it doesn't affect requests that carry the key.

## Look up groups and fields first

The request uses plato's exact group names and custom-field **ids**. Both
lookups are public (no key):

```bash
curl https://plato.courses/v1/groups
# {"userGroups":["University of Illinois Chicago","Louisiana Tech", ...]}

curl https://plato.courses/v1/user-fields
# {"userFields":[
#   {"id":"fld_9a1b2c3d4e5f","label":"Organization","type":"text","required":true},
#   {"id":"fld_0f1e2d3c4b5a","label":"Role","type":"dropdown","required":false,
#    "options":["Teacher","Student"]}
# ]}
```

Field ids never change, even when an admin renames the label or changes the
field's type — map your form to the ids, not the labels. An admin can change
a field's **type** (say, Text → Phone), which tightens its rules from then on,
so re-check the `type` when you update your form. If an admin **deletes** a
field and adds a new one, it gets a new id; re-run the lookup.

## Add someone

```
POST https://plato.courses/v1/waitlist
Content-Type: application/json
Authorization: Bearer wlk_...        ← omit for the no-key route
```

```bash
curl -X POST https://plato.courses/v1/waitlist \
  -H "Authorization: Bearer $PLATO_WAITLIST_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "userGroup": "University of Illinois Chicago",
    "customFields": {
      "fld_9a1b2c3d4e5f": "UIC",
      "fld_0f1e2d3c4b5a": "Teacher"
    }
  }'
```

### Body

| Field | Required | Rules |
| --- | --- | --- |
| `name` | yes | 1–200 characters |
| `email` | yes | a valid address, up to 254 characters; stored lowercase |
| `userGroup` | no | must exactly match one of `GET /v1/groups` |
| `customFields` | if any field is required | object of `{ "<field id>": "<value>" }`; every required field must be present and non-empty |

Values are strings, trimmed. Per field type:

| Type | Rule |
| --- | --- |
| `text` | up to 200 characters |
| `textarea` | up to 2000 characters |
| `dropdown` | must exactly match one of the field's `options` |
| `link` | a full `http://` or `https://` URL |
| `phone` | digits with optional `+`, spaces, `( ) . -`; 7–15 digits |

Unknown field ids are ignored. An empty string means "no answer".

### Responses

| Status | Body | Meaning |
| --- | --- | --- |
| `202` | `{"ok":true}` | Accepted. |
| `400` | `{"error":"Organization is required"}` | The input is invalid; `error` is a human-readable reason you can show to the person. |
| `403` | `{"error":"The wait list is closed"}` | The list is closed and the request had no key, or a wrong one. |

`202` is also returned when the email **already** has an account, a pending
invite, or a wait-list entry — nothing new is stored, and the existing entry
isn't updated. This is deliberate: the API never reveals whether someone is
already registered. So a `202` means "plato has this person in some form",
not necessarily "a new entry was created".

### From a browser (no key)

With the list open, a form on any site can post directly (CORS is allowed
from any origin):

```html
<form id="join">
  <input name="name" required>
  <input name="email" type="email" required>
  <button>Join</button>
</form>
<script>
  document.getElementById('join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const res = await fetch('https://plato.courses/v1/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: f.get('name'), email: f.get('email') }),
    });
    const data = await res.json();
    alert(res.ok ? "You're on the wait list." : data.error);
  });
</script>
```

Don't send a field named `website` from a no-key request: plato's own form
uses it as a hidden spam trap, and a non-empty `website` is silently dropped
(you still get `202`). Keyed requests are exempt.

## Check whether the list is open

```bash
curl https://plato.courses/v1/waitlist
# {"open":false}
```

## Limits and caveats

- **No rate limiting.** Throttle on your side if you're importing in bulk.
- **No bulk endpoint** — send one request per person.
- Submissions don't send the person an email. Their first email from plato is
  the invite.
- Keep the key in your server's secrets store. If it leaks, make a new key in
  the Wait List dialog — the old one stops working at once.

Implementation notes for plato contributors live in
[`ARCHITECTURE.md` → Wait list](ARCHITECTURE.md#wait-list-363).
