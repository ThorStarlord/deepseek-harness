---
description: "Select and inspect authorized DSH Sessions, share attributed snapshots, and deliberately assign bounded work to an associated Session."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-activity-coordination

English | [中文](README.zh.md)

## Summary

Open `/coordinate` in a root Session to select Activity-linked Workspaces and Sessions, inspect bounded authenticated snapshots, and deliberately add selected, attributed evidence to the coordinator conversation. The same panel can save a bounded recommendation, require authenticated confirmation before sending it to a target Session, and add a complete saved responsibility history to a later coordinator conversation. Confirmation grants no additional target permissions, and admission does not establish task completion.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the Web client package with its declared dependencies and the Host `home-activity` service. In a root Session, `/coordinate` opens the read-only discovery panel; a finalized assistant message also offers **Propose responsibility**.

The user selects an Activity and its associated Workspace/Session pairs, previews bounded recent evidence, and explicitly chooses whether to add it to the coordinator conversation. A recommendation is saved against its exact assistant message. The confirmation view displays the Activity and target identities, task, included and excluded scope, prerequisites, known conflicts, and expected outcome. The dialog instructs the user to review the complete responsibility; its send action follows all proposal details. Only **Confirm and send to this Session** uses the authenticated Host route to prompt the selected target.

To reconsider a prior responsibility in another coordinator Session, expand its saved history and choose **Add this responsibility to this conversation**. DSH queues the complete append-only record as a user message; it refuses records over the message limit, and an uncertain submission requires checking the current conversation before trying again.

## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The Client derives candidate pairs from saved Activity references and current Workspace membership. The authenticated Remote rechecks access and identity before reading; discovery does not activate a target Session. Context enters the coordinator only as a normal queued user message that records the exact Activity, source Sessions, cursors, observation times, runtime facts, and included text as untrusted historical evidence.

Responsibility facts use a versioned append-only StorageDomain. A proposal names its coordinating Session, assistant event, target Workspace and Session, bounded task, exclusions, prerequisites, and expected result. An authenticated confirmation is bound to that saved proposal; Host dispatch goes through the Session Gateway and preserves the target's native runtime and permissions. Later reconciliation reads target history without retrying, resuming, or rewriting the delivery.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Home Activity subsystem](../../../docs/subsystems/home-activity.md) — Activity identity, associations, and responsibility records.
- [Home Activity package](../../home/activity/README.md) — Host persistence and coordination Remote.
- [API Remotes](../../api/remotes/README.md) — authenticated Client-to-Host operations.
- [Web application bundle](../../bundle/web-app/README.md) — Web composition that loads this package.

-----

<a id="model-experience"></a>
## Model Experience

### User-selected Activity Session evidence

#### What the model sees

After the user reviews and explicitly adds a preview, the coordinator receives a normal queued user message rendered from `ActivityCoordinationSessionSnapshot` records, with the Activity identity and objective, each selected Workspace and Session identity, observation source and time, event cursor, runtime facts, and bounded recent messages. The message marks target text as untrusted historical evidence, not instructions or authorization.

#### Token effect

Only selected snapshots are submitted, with bounded message count and total context size; selection and preview add no model input.

#### KV Cache effect

The selected evidence is a new Session message and uses the provider's normal cache behavior; prior Session history is not rewritten.

### Confirmed responsibility prompt

#### What the model sees

After the user confirms the exact saved responsibility, the target Session receives its Activity objective, task, scope, exclusions, prerequisites, known conflicts, and expected outcome as a normal user prompt. The prompt requires the target to retain its existing runtime permissions and report uncertainty; it does not grant extra authorization.

#### Token effect

The bounded proposal is added as one ordinary target Session prompt and is counted by the target's normal request path.

#### KV Cache effect

The prompt uses the target provider's normal cache behavior; this package does not revise existing target history.

### Explicit saved responsibility reentry

#### What the model sees

After the user selects a saved responsibility, the current coordinator receives its complete append-only facts, stable identities, actor and source attribution, and recorded timestamps. The message marks all historical fields as untrusted evidence rather than instructions, current state, or authorization.

#### Token effect

The full record is added as one queued user message when it fits the message limit. DSH refuses an oversized record without truncating historical facts.

#### KV Cache effect

The user message uses the coordinator provider's normal cache behavior; target Session history and responsibility facts are not changed.

## Known Limitations and Deferred Work

The current package coordinates selected DSH-native root Sessions; it does not provide a general multi-provider Session abstraction.

- A Session snapshot describes recorded history and observed runtime state at its cursor; it does not establish semantic understanding or current repository contents.
- Reconciliation is an explicit read of one target Session. There is no background supervision, automatic retry, or automatic continuation.
- Target admission confirms prompt delivery only. Execution, independent verification, and user acceptance remain separate facts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
