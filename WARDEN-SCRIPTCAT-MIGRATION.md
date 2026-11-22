# Warden handoff: ScriptCat transport moved to relay-wotr

**Purpose:** separate the ScriptCat implementation from Open BFME while keeping Warden's operational authority and day-to-day work in `Creative36711/open-bfme`.

## Current split

- **Transport implementation / release source:** `Creative36711/relay-wotr`, `tools/script-cat/`.
- **Warden, missions, phase plan, operational decisions and project work:** `Creative36711/open-bfme`.
- **Imported source snapshot:** `Creative36711/open-bfme` main at `54e30c27b3958dc04ad2257c91b65ff150a55558` (22 Nov 2026). The transferred tree is a source snapshot, not a history-preserving Git subtree; see the Git-history note below.
- **Notion Transport Maintainer role:** Agent URL is `https://arena.ai/agent/01a20253-3b69-7685-a69e-af0437ee7f93`; Repository is `Creative36711/relay-wotr`.
- **ScriptCat's WOTR project profile:** `tools/script-cat/wotr-project.json` continues to target `Creative36711/open-bfme@main`. This is intentional: the technical source repo is not the project's task repository.

The Notion role update has been applied. Do not change Warden's repository or profile's project repository to `relay-wotr`.

## Handoff sequence

1. Review and merge the transport import in `relay-wotr` only after the full validation gate is green (`npm run verify:scriptcat`). Verify the Warden's project profile still names `Creative36711/open-bfme` as its project target.
2. Announce a brief pause in the active ScriptCat cycle. Record any in-flight dispatch/run IDs and ensure no operation is pending before changing userscript installs.
3. Install the merged bundle from `https://github.com/Creative36711/relay-wotr/blob/main/tools/script-cat/relay.user.js` (use GitHub's **Raw** view to install). Follow `tools/script-cat/INSTALL.md`; retain a backup of the existing ScriptCat entry/state until the new entry is verified. Do not run both scripts against the same profile. For a fresh setup, import `tools/script-cat/wotr-project.json`. For an existing setup, edit its project profile in **⚙ → Управление проектами** (do not import the same profile ID twice): keep `Creative36711/open-bfme@main` as the main/project repo, add `Creative36711/relay-wotr@main` as a secondary repo, and add the role route `41e6f0cf-5705-815f-9b37-e533c4ccad21` → `Creative36711/relay-wotr`. This is the Transport Maintainer Notion role UUID. Never set `relay-wotr` as the operational/Warden repo.
4. Verify the profile's four Notion source IDs, Warden/role routing, Drive folder/Gateway credentials, and GitHub connection in ScriptCat's connection/project UI. Ensure only the Transport Maintainer route points to `relay-wotr`; project roles still point to `open-bfme`. Secrets are entered locally, never committed or sent to Warden/chat. Keep the cycle held until the owner explicitly permits a smoke run.
5. Run a controlled smoke/pilot on the existing Open BFME operational data and confirm task dispatch, result delivery, acceptance and Warden escalation. Record evidence and any state-recovery caveats. A successful build/test suite alone is not live-service acceptance.
6. **Only after steps 1–5 are accepted**, clean the old transport copies out of Open BFME in a separate, scoped PR. The cleanup must not remove operational Warden documents or project data.

## Open BFME cleanup scope

Remove transport implementation and transport-only release wiring, including, as present on the cleanup branch:

- `tools/script-cat/**` (including `src/`, bundle, tests, gateway, profile template, developer docs and transport fixtures);
- `tools/relay-build.mjs` and `tools/relay-watchdog.mjs`;
- root `package.json` ScriptCat-only scripts and any lockfile changes caused solely by those aliases (retain unrelated project scripts/dependencies);
- `docs/scriptcat-update.md`, ScriptCat-only CI/workflows, and references that tell maintainers to edit/test/release ScriptCat from Open BFME.

Keep in Open BFME:

- Warden's instructions, role/mission records, project regulation, phase plan, mission specifications, acceptance artifacts and all operating records;
- normal project build/test scripts and any project dependencies not exclusively introduced for ScriptCat;
- the project-side profile/configuration information needed to run Warden. If any profile copy is retained, keep it secret-free and make its technical source/release URL point to `relay-wotr`, while its project target remains `open-bfme`.

Before deleting anything, search the entire tracked tree and CI for `ScriptCat`, `script-cat`, `relay.user.js`, `relay-build`, `relay-watchdog`, and `verify:scriptcat`. Classify each match as either transport wiring (remove/update) or operational documentation (retain, editing its links only as needed). Do not mechanically delete every match: Warden must still be able to write technical assignments and define acceptance criteria for work in the transport repository.

**Git history / size caveat:** a cleanup commit removes files from the current Open BFME checkout, but does not remove historical ScriptCat blobs from `.git`; old commits, tags, forks and PR refs may still expose them and clones may still carry their size. The new repo currently imports a file snapshot, not the prior commit history. If “fully clean” means purge the old history as well, make a separate owner-approved archival/backup and coordinated history-rewrite plan after the new installation is accepted. Inventory all branches/tags and GitHub refs first; do not casually force-push or rewrite history in the cleanup PR. Explain the resulting clone/PR-link impact and note that GitHub caches/forks cannot be erased from the project owner’s repository alone.

## Warden's ongoing workflow after cleanup

- For transport defects/features, write the technical task in the Open BFME operational system, but set the task/role repository to `Creative36711/relay-wotr`; scope changes to `tools/script-cat/**` (and the explicitly allowed release/docs paths there). Warden remains the author of the task and the final operational authority; the Transport Maintainer owns transport implementation/release checks.
- For game/project code, continue routing work to `Creative36711/open-bfme` as before.
- Keep one PR per task and preserve the current build/version/guard/test/live-update approval gates. Do not change users' installed versions or enable the cycle as part of a code migration without owner approval.
- When a ScriptCat task requires changes to an Open BFME operational contract, split the work into explicit scoped tasks/PRs and coordinate order; do not silently duplicate or rewrite Warden's source of truth in the transport repo.

## Acceptance checklist

- [ ] ScriptCat code and tests are maintained from `relay-wotr`; no active release/CI path depends on an Open BFME copy.
- [ ] Warden can create, route, and accept a technical task targeting `relay-wotr` while operating from Open BFME.
- [ ] Normal project tasks still target Open BFME.
- [ ] New ScriptCat installation uses the migrated bundle and only one active instance/profile.
- [ ] Live smoke was approved and evidenced; previous installation/state was retained until recovery was verified.
- [ ] Open BFME cleanup PR contains no deletion of Warden/mission/operational material and no unrelated project changes.
