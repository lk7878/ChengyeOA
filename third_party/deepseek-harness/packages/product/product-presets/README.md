---
description: "Reusable product-owned domain Preset templates without Studio's bundled Presets."
kind: "package-reference"
---

# @deepseek-ai/dsh-product-presets

English | [中文](README.zh.md)

## Summary

This directory owns product-authored Agent Presets. Studio's seven bundled presets are intentionally absent.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The [academic Wiki template](templates/academic-wiki/agent.cordis.yml) contains standard Harness tools, academic retrieval instructions and an installation placeholder for the knowledge binding. Its [version manifest](templates/academic-wiki/template.json) records the Harness baseline. The smaller `templates/domain-preset/` remains a binding-only skeleton. Business bindings belong in `agent.cordis.yml`; `preset.yml` contains display metadata only.

### Generate a local instance

First install compatible Harness and Product packages, load the knowledge service in a Product profile, and create or restore the target library. From the Harness repository root, generate a new instance in an already registered Preset root:

```powershell
node packages/product/product-presets/scripts/generate-academic-preset.mjs --preset-root "../.dsh-home/profiles/product/presets" --knowledge-ref "your-library-alias" --id "wiki-academic"
```

Replace the root and library alias or ID for the receiving machine. The example root requires the Product profile's `agent-presets.config.roots` registration; for a new environment the official `<DSH_HOME>/.agent-presets` root is discovered by default unless user roots are disabled. The script does not register roots, install dependencies, inspect credentials or create knowledge data. `--name` changes display text; `--dry-run` previews the destination without writing. See the [installation decision](../specs/F001-llm-wiki-knowledge-base/academic-preset-template.md).

The generated directory contains `agent.cordis.yml`, `preset.yml` and `template-origin.json` with the template version and initial file hashes. Existing directories are never overwritten. To review an upgrade, generate a different `--id`, compare the files and manually preserve local instructions and bindings before switching. An I/O failure can leave a partial new directory for inspection; retry under a new ID. Select the generated Preset in a new Harness session and ask `knowledge_sources` to verify its binding.

<a id="model-experience"></a>
## Model Experience

### Source template

#### What the model sees

Nothing from this package at runtime. After a maintainer copies and installs `agent.cordis.yml`, the concrete domain Preset owns its instructions, tools, and knowledge bindings.

#### Token effect

None from the source template; the installed concrete Preset owns every token cost.

#### KV Cache effect

None from the source template; changing an installed concrete Preset can change the reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This package ships an academic template and binding skeleton, not Studio's seven Presets; other Harness baselines require dependency and composition checks.
- Copying a template does not create the referenced knowledge base.
- Template updates do not synchronize installed instances. The generator never changes an existing Preset or the default selection.

<a id="dev-note"></a>
### Dev Note

Add domain Presets only when a real vertical requirement has been approved.
