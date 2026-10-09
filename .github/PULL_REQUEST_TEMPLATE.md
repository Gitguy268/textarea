<!--
Thanks for contributing. Keep the description short and concrete; the reviewer
mostly wants to know what you changed and why, and whether you ran the tests.

Delete the guidance in each section as you fill it in.
-->

## What this changes

<!-- One paragraph. What is different after this pull request? -->

Fixes #

## Why

<!--
The problem, or the gap. If this is a fix, the line in the README that
described the old behaviour is a good pointer. If it is a feature, what was
missing — not what you added.
-->

## How it was tested

- [ ] `npm run test:all` passes
- [ ] New behaviour has a test that fails without this change
- [ ] Anything user-visible is described in **Differences from upstream** in the README
- [ ] Anything vendored under `vendor/` arrived with its licence file and a line in `vendor/README.md`
- [ ] No new dependency, no build step, nothing fetched from a CDN

<!--
Browser tests go in tests/browser/run.js. Wait on what the app says rather than
on a delay: notification() for the message bubble, until() for anything async in
the page. Note which tests you ran by hand, if any.
-->

## Notes for the reviewer

<!--
Anything worth knowing before reading the diff: a decision you took that could
have gone another way, a place where you were unsure, something you left out on
purpose.
-->
