# Security Policy

## Supported versions

Kvak is pre-1.0 research/hackathon software. Security fixes target the
latest `main` only.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report suspected vulnerabilities privately by opening a
[GitHub Security Advisory](https://github.com/kvak/kvak/security/advisories/new)
("Report a vulnerability"), or contact a maintainer directly. Include:

- A description of the issue and its potential impact
- Steps to reproduce or a proof of concept
- Affected versions/commits, if known

We will acknowledge receipt within 72 hours and aim to send a fix plan within
7 days.

## Scope

This policy covers the code in this repository. Note the application's threat
model:

- **Models run fully on-device.** No prompts or completions leave the phone
  unless you explicitly connect an MCP server.
- **MCP servers (HTTP and Nostr/ContextVM) are opt-in and user-configured.**
  The app talks only to servers you add in Settings. Nostr MCP traffic is
  end-to-end encrypted via [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md).
- **Nostr client identity is ephemeral** — a fresh keypair is generated on each
  launch and is not tied to any persisted identity.

## Out of scope

- Vulnerabilities in bundled third-party models (report upstream to the model
  author / Hugging Face).
- Issues in the underlying [llama.cpp](https://github.com/ggml-org/llama.cpp)
  or [whisper.cpp](https://github.com/ggerganov/whisper.cpp) runtimes (report
  upstream).
- Social engineering or physical access to an unlocked device.
