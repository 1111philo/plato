# After the launch: what's left on partly-done issues

The launch release (#451) delivered part of each issue below. This is what
remains, so the next person (or plato-pilot) starts in the right place.

| Issue | Done in the launch | Left |
|---|---|---|
| #257 How assessment works | Public `/how-assessment-works` page describing what plato actually does; coach asks for learners' own thinking | The three "To be decided by the program team" policies on the page: AI-assisted work, human review and appeals, what course completion certifies (and each course's competencies, written in that classroom's own content) |
| #261 Lesson rewrites | Export/apply scripts; drafts for Foundations 1–3 and AI Leadership 1–7 (UIC-OSF/plato-deploy#6) | Review the drafts, compare before/after with an outside reader, apply with `server/scripts/apply-lessons.js`; then the remaining lessons |
| #385 Admin table columns | Columns dialog (show, hide, reorder; saved per browser) for Users and Lessons; tables scroll instead of clipping | Column resizing |
| #414 Originality feedback | Coach asks for personal examples and reasons, never accuses; the "Your work" checklist only counts evidence in the learner's own words | Any separate visual indicator, once the policy in #257 is set (no AI-text detector, per #272) |
| #443 Getting Started | Bundled lesson, installed and kept current on every install; shown first | Requiring it before other lessons, once completion-based prerequisites (#442) exist |
