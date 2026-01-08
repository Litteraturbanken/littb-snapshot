GIT_COMMIT=$(git ls-remote https://github.com/Litteraturbanken/littb-snapshot.git HEAD | cut -f1)
nomad job run -var="git_commit=$GIT_COMMIT" snapshot.nomad