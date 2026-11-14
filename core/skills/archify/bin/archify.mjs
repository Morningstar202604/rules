#!/usr/bin/env node
// Archify compatibility CLI bundled with this skill pack (pure Node stdlib).
//
// Implements the eight commands the SKILL.md fast path relies on:
// validate / deliver / visual-check / preview / doctor / demo / guide / brands.
// Scope notes (also documented in SKILL.md):
// - validate checks candidate JSON against schemas/<type>.schema.json +
//   schemas/common.schema.json (required fields, types, enums, id refs).
// - deliver renders from assets/template.html and embeds the spec JSON; the
//   upstream interactive renderer pipeline is not part of this bundle.
// - visual-check prints the bounded browser-verification checklist instead of
//   driving a browser.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '2.17.0-dev.1';
const TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];
const TYPE_ALIASES = { 'data-flow': 'dataflow' };

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

function usage() {
  return [
    'Usage: node bin/archify.mjs <command> [args] [options]',
    '',
    'Commands:',
    '  validate [type] <file> [--quality showcase|standard] [--json] [--layout-json]',
    '      Validate a candidate JSON against schemas/<type>.schema.json.',
    '  deliver [type] <file> [output.html] [--out <dir>] [--quality ...] [--json] [--open]',
    '      Copy the bundled template, embed the spec, write HTML + spec snapshot.',
    '  preview [type] <file> [output.html] [--quality ...] [--json]',
    '      Print an HTML skeleton to stdout (or write the template HTML to output.html).',
    '  visual-check <output.html> [--json]',
    '      Print the browser-verification checklist for a delivered HTML.',
    '  doctor',
    '      Check schemas/, renderers/, assets/ and report readiness.',
    '  demo [output-directory]',
    '      Print a sample JSON spec (and write demo files when a directory is given).',
    '  guide [scenario or question] [--json]',
    '      Print the command guide; recommend a diagram type for a scenario.',
    '  brands [name] [--json]',
    `      List available brands from assets/brands/. Diagram types: ${TYPES.join(', ')}.`,
    '',
    'Options:',
    '  --json            machine-readable receipt on stdout',
    '  --quality <name>  standard | showcase (showcase requires meta.quality_profile)',
    '  --out <dir>       output directory for deliver',
    '  --open            open the delivered HTML in the default browser',
    '  --help            show this help',
  ].join('\n');
}

function fail(message, code = EXIT_FAILURE) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function usageError(command, message) {
  process.stderr.write(`${message}\n\n${usage()}\n`);
  process.exit(EXIT_USAGE);
}

function parseArgs(command, argv, options) {
  const parsed = { positionals: [], flags: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      parsed.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    const spec = options[name];
    if (!spec) {
      usageError(command, `Unknown ${command} option "${name.split('=')[0]}"`);
    }
    if (spec.value) {
      const value = inlineValue !== undefined ? inlineValue : argv[++index];
      if (value === undefined) {
        usageError(command, `${command}: option "${name}" requires a value`);
      }
      parsed.flags[spec.key] = value;
    } else {
      parsed.flags[spec.key] = true;
    }
  }
  return parsed;
}

function readJsonFile(file, { what = 'input' } = {}) {
  try {
    return { raw: fs.readFileSync(file), spec: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return { error };
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function embedSpec(spec) {
  return JSON.stringify(spec).replaceAll('<', '\\u003c');
}

function resolveType(explicit, spec, file) {
  let type = explicit ? TYPE_ALIASES[explicit] || explicit : null;
  if (!type && spec && typeof spec === 'object') {
    const fromSpec = spec.diagram_type || spec.type;
    if (typeof fromSpec === 'string') type = TYPE_ALIASES[fromSpec] || fromSpec;
  }
  if (!type) {
    usageError('validate', `cannot determine the diagram type for ${file}; pass <type>`);
  }
  if (!TYPES.includes(type)) {
    usageError('validate', `unknown diagram type "${type}"; expected one of: ${TYPES.join(', ')}`);
  }
  if (spec && typeof spec === 'object') {
    const declared = spec.diagram_type || spec.type;
    if (typeof declared === 'string' && declared !== type) {
      fail(`diagram_type "${declared}" does not match requested type "${type}"`, EXIT_FAILURE);
    }
  }
  return type;
}

function loadSchema(type) {
  const schemaPath = path.join(SKILL_ROOT, 'schemas', `${type}.schema.json`);
  const commonPath = path.join(SKILL_ROOT, 'schemas', 'common.schema.json');
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const common = JSON.parse(fs.readFileSync(commonPath, 'utf8'));
    return { schema, common, schemaPath, commonPath };
  } catch (error) {
    fail(`doctor: schema for "${type}" is unreadable: ${error.message}`, EXIT_FAILURE);
    return null;
  }
}

function resolveDef(ref, common) {
  if (typeof ref !== 'string' || !ref.startsWith('common.schema.json#/$defs/')) return null;
  return common.$defs?.[ref.slice('common.schema.json#/$defs/'.length)] || null;
}

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function checkSpec(spec, type, file, { quality = null, layoutJson = false } = {}) {
  const { schema, common } = loadSchema(type);
  const diagnostics = [];
  let checks = 0;
  const add = (code, subject, evidence, supportedFixes, severity = 'error') => {
    diagnostics.push({ code, severity, subject, evidence, supportedFixes });
  };

  checks += 1;
  if (!schema.required || !Array.isArray(schema.required)) {
    return { diagnostics, checks, ok: false };
  }
  for (const key of schema.required) {
    checks += 1;
    if (spec == null || typeof spec !== 'object' || !(key in spec)) {
      add('schema/required', { diagramType: type, path: '' }, { missing: key },
        [`add the required property "${key}"`]);
    }
  }
  if (spec == null || typeof spec !== 'object') return { diagnostics, checks, ok: false };

  checks += 1;
  const declared = spec.diagram_type;
  const constant = schema.properties?.diagram_type?.const;
  if (constant !== undefined && declared !== constant) {
    add('diagramType/const', { diagramType: type, path: '/diagram_type' },
      { expected: constant, actual: declared ?? null },
      [`set diagram_type to "${constant}"`]);
  }

  checks += 1;
  const meta = spec.meta;
  if (meta == null || typeof meta !== 'object') {
    add('schema/required', { diagramType: type, path: '/meta' }, { missing: 'meta' },
      ['add a meta object with a title']);
  } else {
    const title = meta.title;
    if (typeof title !== 'string' || !title.trim()) {
      add('meta/title', { diagramType: type, path: '/meta/title' }, { actual: title ?? null },
        ['set meta.title to a non-empty string']);
    }
    for (const [field, rule] of Object.entries(schema.properties?.meta?.properties || {})) {
      if (!(field in meta)) continue;
      checks += 1;
      const enumValues = rule.enum || resolveDef(rule.$ref, common)?.enum;
      if (enumValues && !enumValues.includes(meta[field])) {
        add('enum/invalid', { diagramType: type, path: `/meta/${field}` },
          { value: meta[field], allowed: enumValues },
          [`set meta.${field} to one of: ${enumValues.join(', ')}`]);
      }
    }
    if (quality === 'showcase') {
      checks += 1;
      if (meta.quality_profile !== 'showcase') {
        add('meta/quality-profile', { diagramType: type, path: '/meta/quality_profile' },
          { actual: meta.quality_profile ?? null },
          ['set meta.quality_profile to "showcase"']);
      }
    }
  }

  const idUniverse = new Set();
  const collectionIssues = [];
  for (const [key, rule] of Object.entries(schema.properties || {})) {
    if (rule.type !== 'array') continue;
    const value = spec[key];
    if (value === undefined && !schema.required?.includes(key)) continue;
    checks += 1;
    if (!Array.isArray(value)) {
      add('schema/type', { diagramType: type, path: `/${key}` }, { expected: 'array' },
        [`set ${key} to an array`]);
      continue;
    }
    const minItems = typeof rule.minItems === 'number' ? rule.minItems : 0;
    if (value.length < minItems) {
      add('schema/type', { diagramType: type, path: `/${key}` },
        { expected: `at least ${minItems} item(s)`, actual: value.length },
        [`add at least ${minItems} item(s) to ${key}`]);
      continue;
    }
    const itemRequired = rule.items?.required;
    const itemProperties = rule.items?.properties;
    value.forEach((item, index) => {
      const identity = typeof item?.id === 'string' ? item.id : null;
      if (itemProperties && item != null && typeof item === 'object' && schema.additionalProperties !== true) {
        for (const name of Object.keys(item)) {
          if (!(name in itemProperties)) {
            add('schema/additionalProperties', { diagramType: type, path: `/${key}/${index}`, identity },
              { additionalProperty: name }, [`remove unsupported property "${name}"`]);
          }
        }
      }
      for (const field of itemRequired || []) {
        checks += 1;
        if (item == null || typeof item !== 'object' || !(field in item)) {
          collectionIssues.push({ key, index, identity, field });
          add('items/required', { diagramType: type, path: `/${key}/${index}`, identity },
            { missing: field },
            [`set ${field} on ${key}[${index}]${identity ? ` (${identity})` : ''}`]);
        }
      }
      if (identity !== null) {
        checks += 1;
        if (!ID_PATTERN.test(identity)) {
          add('items/id-format', { diagramType: type, path: `/${key}/${index}`, identity }, {},
            ['use ids matching ^[a-zA-Z][a-zA-Z0-9_-]*$']);
        }
        idUniverse.add(identity);
      }
      if (item != null && typeof item === 'object' && typeof item.lane === 'string') {
        idUniverse.add(`lane:${item.lane}`);
      }
    });
  }

  for (const [key, rule] of Object.entries(schema.properties || {})) {
    if (rule.type !== 'array' || !Array.isArray(spec[key])) continue;
    spec[key].forEach((item, index) => {
      if (item == null || typeof item !== 'object') return;
      for (const endpoint of ['from', 'to']) {
        const target = item[endpoint];
        if (typeof target !== 'string') continue;
        checks += 1;
        const laneKey = `lane:${target}`;
        if (!idUniverse.has(target) && !idUniverse.has(laneKey)) {
          add('refs/unknown-endpoint', { diagramType: type, path: `/${key}/${index}`, identity: item.id ?? null },
            { [endpoint]: target }, [`point ${key}[${index}].${endpoint} at an existing id`]);
        }
      }
    });
  }

  if (schema.additionalProperties === false) {
    for (const name of Object.keys(spec)) {
      checks += 1;
      if (!(name in (schema.properties || {}))) {
        add('schema/additionalProperties', { diagramType: type, path: '', identity: null },
          { additionalProperty: name }, [`remove unsupported property "${name}"`]);
      }
    }
  }

  const errors = diagnostics.filter((entry) => entry.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const receipt = {
    schemaVersion: 1,
    ok: errors === 0,
    command: 'validate',
    stage: 'artifact',
    diagramType: type,
    input: file,
    diagnostics,
    summary: { artifactChecks: checks, errors, warnings },
  };
  if (layoutJson) {
    receipt.layout = {
      available: false,
      reason: 'the upstream layout solver is not part of this bundle; schema-level checks only',
    };
  }
  return receipt;
}

function printDiagnostics(receipt) {
  for (const entry of receipt.diagnostics) {
    const where = entry.subject.path || entry.subject.input || entry.diagramType || '';
    const identity = entry.subject.identity ? ` (${entry.subject.identity})` : '';
    process.stderr.write(`[${entry.code}] ${where}${identity}: ${JSON.stringify(entry.evidence)}\n`);
    for (const fix of entry.supportedFixes) process.stderr.write(`    Fix: ${fix}\n`);
  }
}

function specPreset(spec) {
  const preset = spec?.meta?.visual_preset;
  return typeof preset === 'string' && preset ? preset : 'classic';
}

function skeletonHtml(spec, type) {
  const title = typeof spec?.meta?.title === 'string' ? spec.meta.title : 'Archify preview';
  const collections = ['nodes', 'components', 'participants', 'states', 'stages'];
  const boxes = [];
  for (const key of collections) {
    const items = Array.isArray(spec?.[key]) ? spec[key] : [];
    items.forEach((item, index) => {
      if (item == null || typeof item !== 'object') return;
      const label = item.label || item.id || `${key} ${index + 1}`;
      boxes.push({
        id: item.id || `${key}-${index + 1}`,
        label,
        sub: item.lane ? `lane: ${item.lane}` : key,
        col: typeof item.col === 'number' ? item.col : index,
        lane: typeof item.lane === 'string' ? item.lane : key,
      });
    });
    if (boxes.length) break;
  }
  const lanes = Array.isArray(spec?.lanes) ? spec.lanes.map((lane) => lane.label || lane.id) : [];
  const laneIndex = (lane) => lanes.indexOf(lane);
  const width = Math.max(720, (boxes.length ? Math.max(...boxes.map((b) => b.col)) : 0) * 220 + 200);
  const height = Math.max(240, (lanes.length || 1) * 110 + 120);
  const shapes = boxes.map((box, index) => {
    const y = lanes.length ? 60 + Math.max(0, laneIndex(box.lane)) * 110 : 60 + index * 100;
    const x = 40 + Math.max(0, box.col) * 200;
    return `  <g class="archify-node" data-id="${escapeHtml(box.id)}">`
      + `<rect x="${x}" y="${y}" width="180" height="64" rx="8"/>`
      + `<text x="${x + 90}" y="${y + 28}">${escapeHtml(box.label)}</text>`
      + `<text x="${x + 90}" y="${y + 48}" class="sub">${escapeHtml(box.sub)}</text></g>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="archify-compat-cli ${VERSION}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<script type="application/json" id="archify-spec">${embedSpec(spec)}</script>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 24px auto; max-width: ${width}px; padding: 0 16px; }
  .archify-node rect { fill: none; stroke: currentColor; stroke-width: 1.5; }
  .archify-node text { text-anchor: middle; font-size: 14px; fill: currentColor; }
  .archify-node .sub { font-size: 11px; opacity: 0.65; }
  svg { width: 100%; height: auto; color: inherit; }
  .archify-note { font-size: 12px; opacity: 0.7; }
</style>
</head>
<body>
<main class="archify-preview">
  <h1>${escapeHtml(title)}</h1>
  <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}" data-diagram-type="${type}">
${shapes}
  </svg>
  <p class="archify-note">Static HTML skeleton from the bundled compatibility CLI (${type});
  the interactive viewer runtime requires the upstream archify renderer.</p>
</main>
</body>
</html>
`;
}

function templateHtml(spec) {
  const templatePath = path.join(SKILL_ROOT, 'assets', 'template.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  const title = typeof spec?.meta?.title === 'string' ? spec.meta.title : 'Archify diagram';
  return template
    .replaceAll('[PROJECT NAME]', title)
    .replaceAll('[VISUAL PRESET]', specPreset(spec))
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('</head>', `<script type="application/json" id="archify-spec">${embedSpec(spec)}</script>\n</head>`);
}

function resolveOutput({ input, outputPositional, outDir, spec }) {
  if (outputPositional) return path.resolve(outputPositional);
  const inputDir = path.dirname(path.resolve(input));
  const declared = typeof spec?.meta?.output === 'string' && spec.meta.output.trim()
    ? spec.meta.output.trim() : null;
  if (outDir) {
    const name = declared ? path.basename(declared) : `${path.basename(input, path.extname(input))}.html`;
    return path.join(path.resolve(outDir), name);
  }
  if (declared) return path.resolve(inputDir, declared);
  return path.join(inputDir, `${path.basename(input, path.extname(input))}.html`);
}

function openInBrowser(target) {
  const command = process.platform === 'win32'
    ? [process.env.comspec || 'cmd.exe', '/c', 'start', '', target]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', target];
  try {
    const child = spawn(command[0], command.slice(1), { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function commandValidate(parsed) {
  const { positionals, flags } = parsed;
  let explicitType = null;
  let file = null;
  if (positionals.length >= 2) {
    explicitType = positionals[0];
    file = positionals[1];
  } else if (positionals.length === 1) {
    file = positionals[0];
  } else {
    usageError('validate', `validate requires a candidate JSON file\n\n${usage()}`);
  }
  if (flags.quality && !['standard', 'showcase'].includes(flags.quality)) {
    usageError('validate', `unknown quality profile "${flags.quality}"; expected standard or showcase`);
  }
  const loaded = readJsonFile(file);
  if (loaded.error) {
    const receipt = {
      schemaVersion: 1,
      ok: false,
      command: 'validate',
      stage: 'input',
      diagnostics: [{
        code: 'input/json-parse',
        severity: 'error',
        subject: { input: file },
        evidence: { reason: `invalid JSON: ${loaded.error.message}` },
        supportedFixes: ['repair the JSON syntax and run validation again'],
      }],
      summary: { artifactChecks: 1, errors: 1, warnings: 0 },
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    } else {
      printDiagnostics(receipt);
    }
    process.exit(EXIT_FAILURE);
  }
  const type = resolveType(explicitType, loaded.spec, file);
  const receipt = checkSpec(loaded.spec, type, file, {
    quality: flags.quality || null,
    layoutJson: Boolean(flags['layout-json']),
  });
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } else if (receipt.ok) {
    process.stdout.write(
      `validate: ok — ${type}, ${receipt.summary.artifactChecks} artifact checks, `
      + `${receipt.summary.errors} errors, ${receipt.summary.warnings} warnings\n`,
    );
  } else {
    printDiagnostics(receipt);
  }
  process.exit(receipt.ok ? EXIT_OK : EXIT_FAILURE);
}

function commandDeliver(parsed) {
  const { positionals, flags } = parsed;
  let explicitType = null;
  let file = null;
  let outputPositional = null;
  if (positionals.length >= 3) {
    [explicitType, file, outputPositional] = positionals;
  } else if (positionals.length === 2) {
    [explicitType, file] = positionals;
  } else if (positionals.length === 1) {
    [file] = positionals;
  } else {
    usageError('deliver', `deliver requires a candidate JSON file\n\n${usage()}`);
  }
  if (flags.quality && !['standard', 'showcase'].includes(flags.quality)) {
    usageError('deliver', `unknown quality profile "${flags.quality}"; expected standard or showcase`);
  }
  const loaded = readJsonFile(file);
  if (loaded.error) {
    fail(`deliver: ${file} is not readable JSON: ${loaded.error.message}`, EXIT_FAILURE);
  }
  const type = resolveType(explicitType, loaded.spec, file);
  const receipt = checkSpec(loaded.spec, type, file, { quality: flags.quality || null });
  if (!receipt.ok) {
    // A failed delivery preserves any previous output at the target path.
    if (flags.json) process.stdout.write(`${JSON.stringify({ ...receipt, command: 'deliver' }, null, 2)}\n`);
    else printDiagnostics(receipt);
    process.exit(EXIT_FAILURE);
  }
  const output = resolveOutput({ input: file, outputPositional, outDir: flags.out, spec: loaded.spec });
  const html = Buffer.from(templateHtml(loaded.spec), 'utf8');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  const snapshot = `${output.slice(0, -path.extname(output).length) || output}.spec.json`;
  fs.writeFileSync(snapshot, loaded.raw);
  const lines = [
    `Delivered: ${output} (${html.length} bytes, sha256 ${sha256(html)})`,
    `Spec snapshot: ${snapshot} (${loaded.raw.length} bytes, sha256 ${sha256(loaded.raw)})`,
    `Validation: ${receipt.summary.artifactChecks} artifact checks, 0 errors`,
  ];
  if (flags.open) {
    lines.push(openInBrowser(output)
      ? `Opened in browser: ${output}`
      : 'Could not open a browser automatically; open the delivered HTML manually.');
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      ok: true,
      command: 'deliver',
      diagramType: type,
      output,
      specSnapshot: snapshot,
      bytes: { spec: loaded.raw.length, artifact: html.length },
      sha256: { spec: sha256(loaded.raw), artifact: sha256(html) },
      summary: receipt.summary,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  process.exit(EXIT_OK);
}

function commandPreview(parsed) {
  const { positionals, flags } = parsed;
  let explicitType = null;
  let file = null;
  let outputPositional = null;
  if (positionals.length >= 3) {
    [explicitType, file, outputPositional] = positionals;
  } else if (positionals.length === 2) {
    [explicitType, file] = positionals;
  } else if (positionals.length === 1) {
    [file] = positionals;
  } else {
    usageError('preview', `preview requires a candidate JSON file\n\n${usage()}`);
  }
  const loaded = readJsonFile(file);
  if (loaded.error) {
    fail(`preview: ${file} is not readable JSON: ${loaded.error.message}`, EXIT_FAILURE);
  }
  const type = resolveType(explicitType, loaded.spec, file);
  if (outputPositional || flags.out) {
    const output = resolveOutput({
      input: file,
      outputPositional,
      outDir: flags.out,
      spec: loaded.spec,
    });
    const html = Buffer.from(templateHtml(loaded.spec), 'utf8');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, html);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1, ok: true, command: 'preview', diagramType: type, output,
        bytes: { artifact: html.length }, sha256: { artifact: sha256(html) },
      }, null, 2)}\n`);
    } else {
      process.stdout.write(`Preview written: ${output} (${html.length} bytes)\n`);
    }
    process.exit(EXIT_OK);
  }
  process.stdout.write(skeletonHtml(loaded.spec, type));
  process.exit(EXIT_OK);
}

function commandVisualCheck(parsed) {
  const { positionals, flags } = parsed;
  const file = positionals[0];
  if (!file || positionals.length > 1) {
    usageError('visual-check', `visual-check requires exactly one output HTML path\n\n${usage()}`);
  }
  if (!fs.existsSync(file)) {
    const message = `visual-check: file not found: ${file}`;
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1,
        ok: false,
        command: 'visual-check',
        stage: 'input',
        diagnostics: [{
          code: 'input/file-missing',
          severity: 'error',
          subject: { input: file },
          evidence: { reason: 'the delivered HTML does not exist at this path' },
          supportedFixes: ['pass the exact path written by deliver'],
        }],
        summary: { artifactChecks: 1, errors: 1, warnings: 0 },
      }, null, 2)}\n`);
    } else {
      process.stderr.write(`${message}\n`);
    }
    process.exit(EXIT_FAILURE);
  }
  const bytes = fs.readFileSync(file);
  const checklist = [
    'Open the delivered HTML in a real browser (Chrome or Edge).',
    'Check scrollWidth <= window.innerWidth and scrollHeight <= window.innerHeight at:',
    '  1440x900, 1600x1000, 1920x1080 (add 2048x1320 for large-desktop compositions).',
    'Confirm the diagram is readable and vertically balanced at the largest checked viewport.',
    'Confirm dark/light switching preserves the current visual preset.',
    'This command does not drive a browser; record the manual browser evidence yourself',
    'and keep perceptual review separate from automated checks.',
  ];
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      ok: true,
      command: 'visual-check',
      file,
      sha256: sha256(bytes),
      bytes: bytes.length,
      browserEvidence: 'manual-checklist-required',
      checks: checklist,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`visual-check: manual browser verification required for ${file}\n`);
    for (const line of checklist) process.stdout.write(`  ${line}\n`);
  }
  process.exit(EXIT_OK);
}

function commandDoctor(parsed) {
  if (parsed.positionals.length > 0) {
    usageError('doctor', `doctor takes no arguments\n\n${usage()}`);
  }
  const required = [];
  const check = (label, present, detail = '') => {
    required.push(present);
    process.stdout.write(`[${present ? 'ok' : 'missing'}] ${label}${detail ? ` — ${detail}` : ''}\n`);
  };
  const rel = (...parts) => path.join(SKILL_ROOT, ...parts);
  const exists = (file) => { try { return fs.existsSync(file); } catch { return false; } };

  check(`Node.js v${process.versions.node}`, true);
  check('Core template', exists(rel('assets', 'template.html')));
  const schemas = [...TYPES.map((type) => `${type}.schema.json`), 'common.schema.json'];
  const missingSchemas = schemas.filter((name) => !exists(rel('schemas', name)));
  check('Diagram schemas', missingSchemas.length === 0,
    missingSchemas.length ? `missing: ${missingSchemas.join(', ')}` : `${schemas.length} schemas`);
  check('Renderer references', exists(rel('renderers', 'workflow', 'README.md')));
  const brandDir = rel('assets', 'brands');
  let brandCount = 0;
  try { brandCount = fs.readdirSync(brandDir).filter((name) => name.endsWith('.json')).length; } catch { brandCount = 0; }
  check('Brand catalog', brandCount > 0, `${brandCount} brands in assets/brands/`);
  const references = ['authoring-contract.md', 'delivery-contract.md', 'viewer-runtime.md', 'brand-marks.md'];
  const missingRefs = references.filter((name) => !exists(rel('references', name)));
  check('Authoring references', missingRefs.length === 0,
    missingRefs.length ? `missing: ${missingRefs.join(', ')}` : `${references.length} references`);

  const missing = required.filter((present) => !present).length;
  if (missing === 0) {
    process.stdout.write('Archify is ready.\n');
    process.exit(EXIT_OK);
  }
  process.stderr.write(`Archify is not ready: ${missing} required item${missing === 1 ? '' : 's'} missing.\n`);
  process.exit(EXIT_FAILURE);
}

function sampleSpec() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Agent Tool Call Workflow (Demo)',
      quality_profile: 'showcase',
    },
    lanes: [
      { id: 'ui', label: 'User Interface' },
      { id: 'agent', label: 'Agent Runtime' },
      { id: 'tools', label: 'Tool Execution' },
    ],
    nodes: [
      { id: 'ask', lane: 'ui', col: 0, type: 'frontend', label: 'User asks a question' },
      { id: 'plan', lane: 'agent', col: 1, type: 'backend', label: 'Plan the tool call' },
      { id: 'policy', lane: 'agent', col: 2, type: 'security', label: 'Policy gate' },
      { id: 'exec', lane: 'tools', col: 3, type: 'backend', label: 'Execute the tool' },
      { id: 'reply', lane: 'ui', col: 4, type: 'frontend', label: 'Reply to the user' },
    ],
    edges: [
      { from: 'ask', to: 'plan', label: 'prompt' },
      { from: 'plan', to: 'policy', label: 'proposed call' },
      { from: 'policy', to: 'exec', label: 'approved' },
      { from: 'exec', to: 'reply', label: 'result' },
    ],
  };
}

function commandDemo(parsed) {
  const { positionals, flags } = parsed;
  if (positionals.length > 1) {
    usageError('demo', `demo takes at most one output directory\n\n${usage()}`);
  }
  const spec = sampleSpec();
  const json = `${JSON.stringify(spec, null, 2)}\n`;
  if (positionals.length === 1) {
    const dir = path.resolve(positionals[0]);
    fs.mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, 'archify-demo.json');
    const htmlPath = path.join(dir, 'archify-demo.html');
    fs.writeFileSync(jsonPath, json);
    fs.writeFileSync(htmlPath, templateHtml(spec));
    process.stdout.write(json);
    process.stdout.write(`Demo written: ${jsonPath}\nDemo written: ${htmlPath}\n`);
    process.stdout.write('Next: open the HTML in your browser.\n');
    process.exit(EXIT_OK);
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, command: 'demo', spec }, null, 2)}\n`);
  } else {
    process.stdout.write(json);
  }
  process.exit(EXIT_OK);
}

const SCENARIO_KEYWORDS = [
  { type: 'architecture', words: ['component', 'service', 'infrastructure', 'boundary', 'deployment', '架构', '组件', '服务'] },
  { type: 'workflow', words: ['process', 'approval', 'runbook', 'gate', 'ci', 'cd', 'procedure', '流程', '审批', '工作流'] },
  { type: 'sequence', words: ['api', 'request', 'call chain', 'handshake', 'trace', 'sequence', '时序', '调用链', '请求'] },
  { type: 'dataflow', words: ['pipeline', 'etl', 'elt', 'lineage', 'ingest', 'governance', '数据流', '管道', '血缘'] },
  { type: 'lifecycle', words: ['state', 'status', 'retry', 'lifecycle', 'state machine', 'terminal', '状态', '生命周期', '重试'] },
];

function recommendType(scenario) {
  const haystack = scenario.toLowerCase();
  const scores = SCENARIO_KEYWORDS.map(({ type, words }) => ({
    type,
    matched: words.filter((word) => haystack.includes(word)),
  }));
  scores.sort((a, b) => b.matched.length - a.matched.length);
  const best = scores[0];
  if (!best.matched.length) {
    return { id: 'workflow', diagramType: 'workflow', matched: [],
      reason: 'no strong keyword match; workflow is the default for procedural scenarios' };
  }
  return {
    id: best.type,
    diagramType: best.type,
    matched: best.matched,
    reason: `matched keyword(s): ${best.matched.join(', ')}`,
  };
}

function commandGuide(parsed) {
  const { positionals, flags } = parsed;
  const scenario = positionals.join(' ').trim();
  if (!scenario) {
    process.stdout.write(`${usage()}\n`);
    process.stdout.write(`
Scenario router
  architecture  components, services, cloud/security boundaries, infrastructure
  workflow      processes, approval gates, tool calls, runbooks, CI/CD
  sequence      API call chains, request lifecycles, async traces
  dataflow      pipelines, ETL/ELT, lineage, governance, consumers
  lifecycle     state/status transitions, retries, waiting and terminal states

Pass a scenario for a recommendation: node bin/archify.mjs guide "Show an API request with a cache miss" --json
`);
    process.exit(EXIT_OK);
  }
  const recommendation = recommendType(scenario);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      ok: true,
      command: 'guide',
      scenario,
      recommendation,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`Recommended diagram type: ${recommendation.diagramType}\nReason: ${recommendation.reason}\n`);
  }
  process.exit(EXIT_OK);
}

function commandBrands(parsed) {
  const { positionals, flags } = parsed;
  const brandDir = path.join(SKILL_ROOT, 'assets', 'brands');
  let brands = [];
  try {
    brands = fs.readdirSync(brandDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        try { return JSON.parse(fs.readFileSync(path.join(brandDir, name), 'utf8')); }
        catch { return null; }
      })
      .filter((entry) => entry && typeof entry === 'object' && entry.id);
  } catch {
    brands = [];
  }
  if (positionals[0] === 'capture') {
    const url = positionals[1];
    if (!url || positionals.length > 2) {
      usageError('brands', `brands capture requires exactly one URL\n\n${usage()}`);
    }
    captureBrand(url, flags);
    return;
  }
  const filter = positionals.join(' ').trim().toLowerCase();
  const filtered = filter
    ? brands.filter((brand) => [brand.id, brand.name, ...(brand.aliases || [])]
      .some((value) => String(value || '').toLowerCase().includes(filter)))
    : brands;
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, command: 'brands', count: filtered.length, brands: filtered }, null, 2)}\n`);
  } else if (filtered.length === 0) {
    process.stdout.write('No matching brands found.\n');
  } else {
    for (const brand of filtered) {
      const aliases = brand.aliases?.length ? ` (aliases: ${brand.aliases.join(', ')})` : '';
      process.stdout.write(`${brand.id}  ${brand.name}${aliases}  ${brand.url || ''}${brand.color ? `  ${brand.color}` : ''}\n`);
    }
    process.stdout.write(`${filtered.length} brand(s) available in assets/brands/.\n`);
  }
  process.exit(EXIT_OK);
}

async function captureBrand(url, flags) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('protocol');
  } catch {
    fail('brands capture: URL must be a valid http(s) URL', EXIT_USAGE);
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const id = parsedUrl.hostname.replace(/^www\./, '').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const titleMatch = /<title[^>]*>([^<]{1,80})/i.exec(body.toString('utf8'));
    const brand = {
      id,
      name: titleMatch ? titleMatch[1].trim() : parsedUrl.hostname,
      url: `${parsedUrl.protocol}//${parsedUrl.host}`,
      sha256: sha256(body),
      capturedFrom: url,
    };
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, command: 'brands', brand }, null, 2)}\n`);
    } else {
      process.stdout.write(`Captured brand: ${brand.id} (${brand.name}), digest-pinned sha256 ${brand.sha256}\n`);
      process.stdout.write('Note: capture performs a live network request; render and validate never capture.\n');
    }
    process.exit(EXIT_OK);
  } catch (error) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1, ok: false, command: 'brands', stage: 'capture',
        diagnostics: [{ code: 'capture/network', severity: 'error', subject: { url },
          evidence: { reason: String(error && error.message || error) },
          supportedFixes: ['retry with network access, or author the diagram without a brand'] }],
      }, null, 2)}\n`);
    } else {
      process.stderr.write(`brands capture failed: ${error && error.message || error}\n`);
    }
    process.exit(EXIT_FAILURE);
  }
}

const COMMANDS = {
  validate: {
    run: commandValidate,
    options: {
      '--json': { key: 'json' },
      '--quality': { key: 'quality', value: true },
      '--layout-json': { key: 'layout-json' },
    },
  },
  deliver: {
    run: commandDeliver,
    options: {
      '--json': { key: 'json' },
      '--quality': { key: 'quality', value: true },
      '--out': { key: 'out', value: true },
      '--open': { key: 'open' },
    },
  },
  preview: {
    run: commandPreview,
    options: {
      '--json': { key: 'json' },
      '--quality': { key: 'quality', value: true },
      '--out': { key: 'out', value: true },
    },
  },
  'visual-check': {
    run: commandVisualCheck,
    options: { '--json': { key: 'json' } },
  },
  doctor: { run: commandDoctor, options: {} },
  demo: { run: commandDemo, options: { '--json': { key: 'json' } } },
  guide: { run: commandGuide, options: { '--json': { key: 'json' } } },
  brands: { run: commandBrands, options: { '--json': { key: 'json' } } },
};

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
  process.stdout.write(`${usage()}\n`);
  process.exit(EXIT_OK);
}
const command = argv[0];
if (!COMMANDS[command]) {
  process.stderr.write(`Unknown command "${argv[0]}".\n\n${usage()}\n`);
  process.exit(EXIT_USAGE);
}
const entry = COMMANDS[command];
const parsed = parseArgs(command, argv.slice(1), entry.options);
if (parsed.flags.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(EXIT_OK);
}
entry.run(parsed);
