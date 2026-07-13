# Security policy

## Supported versions

Until the first public tag is published, security fixes target the current
`master` branch. After v0.1.0, the latest tagged release and `master` are the
supported lines unless a release note says otherwise.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** flow in the repository Security
tab. It opens a private advisory visible only to the maintainers.

Do not open a public issue for a suspected vulnerability, exposed credential,
or report containing private workflow data. If private reporting is
temporarily unavailable, open a content-free issue asking a maintainer to
enable a private contact channel.

Include only what is needed to reproduce and assess the problem:

- affected commit or version;
- impact and prerequisites;
- minimal reproduction steps;
- suggested mitigation, if known.

Never include real API keys, OAuth tokens, customer data, prompts, generated
plans, or private registry/LAB data. Use synthetic examples and revoke any
credential that may have been exposed.

## Security boundary

OrchestrateMCP is a read-only, stateless planning service. It does not store
workflow credentials, run planned workflows, or make LLM calls inside MCP
tools. Generated workflow examples may require third-party credentials; those
credentials belong in the target platform's secret manager and must never be
committed to this repository.

This boundary reduces risk but is not a guarantee that the software is free of
vulnerabilities. Reports involving MCP transport handling, unsafe generated
instructions, secret exposure, authorization assumptions, or dependency
vulnerabilities are in scope.
