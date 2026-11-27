# Relay Container Manager (Firefox)

Firefox companion add-on for unattended Relay operation. It is deliberately a
separate WebExtension: ScriptCat userscripts do not have the privileged
`contextualIdentities` / `tabs` APIs and must not attempt to cross container
boundaries.

## What it does

- Polls the local Relay snapshot at `http://127.0.0.1:8787/api/snapshot`.
- Matches each enabled Relay slot to exactly one existing Firefox container by
  its configured **Контейнер** name. Missing or ambiguous matches fail closed.
- Reuses an Arena tab already in that container, or opens one in that exact
  container in the background. It never moves a tab or copies cookies.
- Keeps the admin slot available for an outstanding coordinator turn or while
  Relay auto mode is enabled; opens worker slots for assigned work.
- **Never changes which window or tab is in front.** The add-on used to raise the
  Admin window on every new coordinator turn; that turned "sending works" into a
  requirement for the owner to keep that tab in front. ScriptCat now stretches
  its own deadlines in a background tab, so the add-on leaves the foreground
  alone. To look at a container tab, use the pult's **Открыть вкладку** button:
  the page asks the content bridge, and the bridge forwards one `focus` request.
  Requests are accepted only from the local pult (`127.0.0.1:8787`).
- Tells the ScriptCat tab bridge whether the Relay auto mode is on. Relay mode
  is the source of truth; page scripts cannot call the extension APIs.
- Closes only worker tabs created by this add-on, after three idle minutes and
  only when Relay reports no active run, queued assignment, or local pending /
  expect state. User-created tabs and the admin tab are never closed automatically.

Relay itself runs the auto dispatcher every 15 seconds while the persisted
`cycle.mode` setting is `auto`. It schedules waiting queue work and requests a
coordinator turn when the queue is empty. The extension opens the corresponding
container tab so ScriptCat can execute it. Manual `Шаг` remains one-shot; if it
needs an admin turn, the same manager opens/reuses the admin tab.

## Development install

Requires Firefox 142 or newer (for the declared no-data-collection manifest
metadata and the current WebExtension APIs).

1. Start Node Relay as usual on `127.0.0.1:8787` and configure the Relay slots.
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on…** and select this folder's `manifest.json`.
4. Keep the existing named containers. The manager does not create or recreate
   identities, because doing so cannot restore a deleted container's cookies.
5. Open the add-on popup to inspect Relay connectivity and container mismatches.

Temporary add-ons are removed when Firefox closes. For everyday use, package
and sign this add-on for Firefox (for example, as an unlisted AMO extension).
No signing credentials or browser policy bypass is part of this repository.

## Safety and limitations

- Permissions are limited to container identities, tabs/storage/alarms, the
  local Relay address, and Arena pages. The add-on does not read passwords or
  cookies. The bridge that runs on the pult page forwards one message type and
  receives one answer; it has no access to `browser.tabs` from the page.
- New setups start in auto mode. On upgrade, the old `manual` value is migrated
  to `auto` only when the sheet marks it as the former default; a deliberate
  manual choice made in this release remains manual after restart. The Relay
  panel can switch modes at any time.
- This first iteration does not close admin tabs, and does not close user-owned
  worker tabs. Add-on-created idle worker tabs close after three minutes; the
  corresponding Firefox container and its cookie jar remain intact.
- Browser-level validation is still required on the target Firefox profile:
  extension signing, Firefox container API behavior, ScriptCat permission
  prompts, Arena login state, and the complete coordinator → worker → review
  cycle cannot be proven by Node unit tests alone.
