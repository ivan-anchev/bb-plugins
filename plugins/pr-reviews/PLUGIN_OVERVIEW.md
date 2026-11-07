PR Reviews adds a **PR Reviews** app to bb's left rail. It lists a GitHub
project's open pull requests and opens each one as a guided review, written by
a review thread, that walks you through the change step by step. Nothing is
ever posted to GitHub.

## What you get

- **Your GitHub projects**: the sidebar's picker lists the bb projects whose
  git remote is on github.com, and remembers the one you chose last.
- **Open pull requests**: each row shows the PR's number, title, author, when
  it was last updated, and its review state in words.
- **A page per pull request**: its title, author, `branch → base`, and a link
  to the PR on GitHub, above its guide.
- **Errors beside your data**: if GitHub can't be read, the error shows above
  the list you already had. Refresh, or click the open PR again, to retry.

## How it works

PR Reviews reads pull requests with the GitHub CLI (`gh`) on the machine that
runs bb, so `gh` must be installed and signed in there. It only reads: it
never comments, approves, or changes anything on GitHub.
