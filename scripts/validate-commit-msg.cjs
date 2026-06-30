const fs = require("fs");

const messageFile = process.argv[2];

if (!messageFile) {
  console.error("Commit message file path is required.");
  process.exit(1);
}

const firstLine = fs.readFileSync(messageFile, "utf8").split(/\r?\n/, 1)[0] ?? "";
const conventionalCommitPattern =
  /^(feat|fix|chore|refactor|test|docs|style|build|ci|perf|revert)(\([^)]+\))?!?: .+/;

if (!conventionalCommitPattern.test(firstLine)) {
  console.error(
    "Commit message must follow Conventional Commits format (e.g. feat(scope): message)",
  );
  process.exit(1);
}
