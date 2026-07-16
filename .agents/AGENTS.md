# Strict Verification Protocol

- **No Half-Measures**: When asked to make a system dynamic, you MUST investigate the entire stack (Frontend UI, Backend Proxy, API responses). Do not assume the frontend logic is complete without verifying the backend supplies the necessary endpoints and vice versa.
- **Self-Correction & Cleanup**: Before concluding a task or committing code, you MUST review the diffs of your own changes to ensure you didn't leave placeholder text, hardcoded legacy logic, or unneeded mock variables behind.
- **Data Validation First**: Always run a local test using `curl` or `node` to verify the actual shape, contents, and timestamps of API data BEFORE writing logic based on assumptions of what the data might look like.
- **Continuous Alignment**: If a user's instructions imply a broader scope (e.g., "the server should send this"), recognize that the task involves full-stack architecture, not just UI tweaks.
