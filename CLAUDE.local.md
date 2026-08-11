# deadair — local notes

## Git workflow
- Commit directly to `main`. Don't create a branch unless there's a specific reason (e.g. a risky/experimental change I want isolated). I'm the only one working on this and it's still early, so the default-branch "branch first" convention doesn't apply here.

## Nothing has shipped
- deadair has never been released and has exactly one operator, running one install. There is no
  deployed version to stay compatible with, and there never has been.
- So: change shapes in place. Schema versions (`ANALYSIS_SCHEMA_VERSION`), plugin contract shapes,
  migrations and stored rows are all free to be edited rather than versioned around. Migrations are
  rolled down and edited, not superseded (see the memory note on that); a stored row of the wrong
  shape is dropped and regenerated, not read through a compatibility path.
- Don't bump a version, add a fallback branch, or keep an old field alive "for existing data" unless
  I say the data is expensive to regenerate. Re-measuring the catalog or re-running an ingest is
  cheap and unattended; a compatibility path is permanent.
- This keeps getting re-derived from first principles mid-task and costing a pass, which is why it is
  written down here rather than worked out again.
