# Making a release

The repository is public, so a release is seen by everyone. The owner is asked first, every time. The rules behind these steps are in
`CLAUDE.md` (Commits and releases): a release is built and signed only from its tagged commit, with nothing uncommitted or untracked.

## What signing needs (once per computer)

The same as every OpenStage tool: `signtool.exe` from the Windows SDK (10.0.22621 or later), Microsoft's signing library, the .NET 8
runtime, 7-Zip, and a sign-in to the signing service (`az login`). The account's four settings (`OPENSTAGE_SIGN_ENDPOINT`,
`OPENSTAGE_SIGN_ACCOUNT`, `OPENSTAGE_SIGN_PROFILE` and `OPENSTAGE_SIGN_PUBLISHER`, which is `Jason Wrench`) come from the environment and
never go into the repository. `python tools/sign_windows.py --ready` says what is missing and signs nothing.

`tools/sign_windows.py` is the suite's shared copy (from OpenExplainer, unchanged). A change to it is made in every tool's copy.

## Each release

1. Raise the version in `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`, `app/package.json` and `core/package.json` (and the
   two `package-lock.json` files). The build stops if they differ.
2. Run the tests (`RUN TESTS.bat`). Commit everything, checking the identity first (`CLAUDE.md`), and push the commit to `main`.
3. Tag that commit `v<version>` (`git tag -a v0.6.0 -m "OpenStage Package Doctor 0.6.0"`). Do not push the tag yet.
4. In a PowerShell window with the four settings set: `node tools/build-installer.mjs --sign`. It stops at once if anything is uncommitted
   or untracked or HEAD is not the tag, and checks again at the end, removing the setup if the build changed a file git tracks. It stops on
   any problem: a program that names this computer's user folder, an installer that would download the web view's setup, or a program in
   the setup that is not signed and timestamped. It writes `app/src-tauri/target/release-files/OpenStage-Package-Doctor-<version>-Setup.exe`
   and its `.sha256.txt`.
5. If the build shows something to fix: commit the fix, and move the tag to it, but only while the tag has never been pushed. A pushed tag
   never moves; the fix takes a new version and a new tag.
6. Push the tag, then make the GitHub release on it with exactly those two files, titled "OpenStage Package Doctor <version>", with notes in
   plain words: what it does, who signed it, the SHA-256, and what has not been tried (`TESTING-TODO.md`). No attribution lines.
7. Check the release: the tag points at the commit, GitHub's SHA-256 of the setup is the one computed, and a downloaded copy is signed.
8. OpenStage Hub lists the release once its catalog names it: in the OpenStage-Hub repository, run `Update OpenStage Catalog.bat`, which
   signs the catalog with the hub key (its password is the owner's).

`node tools/build-installer.mjs` without `--sign` builds the same setup, unsigned, for checking. It is not for giving to people.
