---
description: "Save, list, and reopen named user-directed Activities independently of agent Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-home-activity

English | [中文](README.zh.md)

## Summary

Save a named Activity with an objective and descriptive boundaries that remain available after its original Session ends. List and reopen the same Activity through the Web `/activity` command. Creating or opening an Activity does not execute the objective, create a Goal, associate a Session, or grant runtime permissions.

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

The Web profile mounts this service with the JSON StorageDomain provider and the human `/activity` command.

### When to choose it

Choose an Activity when a user-directed undertaking needs a stable identity and saved intent independent of a Session. Use a Session for interaction history, a Goal for same-Session completion tracking, or a Workspace project for directory grouping.

### Minimal configuration

The service declares no configuration fields. A custom composition supplies the existing storage stack before mounting the service:

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/storages
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-home-activity'
```

The storage providers own their settings; see the [JSON backend](../../storage/storage-json/README.md) and [StorageDomain](../../storage/storage-domain/README.md) references.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Activity records use the version-1 `home_activities` StorageDomain and are independent of Session, Goal, and Workspace records. The service exposes durable creation and synchronous reads; it has no execution or activation path.

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Activity identity and request types |
| [`src/spec.ts`](src/spec.ts) | Versioned persisted record schema |
| [`src/index.ts`](src/index.ts) | StorageDomain service |
| [`tests/activity.spec.ts`](tests/activity.spec.ts) | Storage close, reopen, and validation behavior |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Home Activity subsystem](../../../docs/subsystems/home-activity.md) — domain and persistence semantics.
- [StorageDomain](../../storage/storage-domain/README.md) — versioned host-side records.
- [Web `/activity` command](../../interaction/command-home-activity/README.md) — create, list, and open Activities.

-----

<a id="model-experience"></a>
## Model Experience

None, as the service persists Activity records without adding model context or tools.

#### KV Cache effect

None; Activity reads and writes do not change model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The current record preserves user intent without coordinating execution.

- Boundaries are descriptive statements, not sandbox roots or permission grants.
- Activities are not linked to repositories, Sessions, delegated work, reusable knowledge, or execution evidence.
- The service has no edit, delete, scheduling, or execution operation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
