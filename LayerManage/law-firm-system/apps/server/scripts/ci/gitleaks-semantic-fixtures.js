'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const documentedPlaceholders = [
  ['chengye', '_local', '_only'].join(''),
  ['chengye', '_test', '_local', '_only'].join(''),
  ['0123456789', '0123456789', '0123456789', '01'].join(''),
  ['first', '-32-character', '-application-key'].join(''),
  ['second', '-32-character', '-app-key'].join(''),
  ['replace_with', '_at_least_32', '_random_characters'].join(''),
  ['replace_with', '_first', '_application_key'].join(''),
  ['replace_with', '_second', '_application_key'].join(''),
];

const prefix = ['semantic', 'fixture', 'prefix'].join('-');
const suffix = ['semantic', 'fixture', 'suffix'].join('-');
const prefixedAndSuffixedVariants = documentedPlaceholders.flatMap(placeholder => [
  `${prefix}-${placeholder}`,
  `${placeholder}-${suffix}`,
  `semantic.fixture.prefix.${placeholder}`,
  `semantic@fixture@prefix@${placeholder}`,
  `${placeholder}/semantic/fixture/suffix`,
  `${placeholder}+semantic+fixture+suffix`,
  `-${placeholder}`,
  `${placeholder}-`,
  `:${placeholder}`,
  `${placeholder}@`,
  `!${placeholder}`,
  `${placeholder}%`,
]);

function parseGitleaksAllowlistRegexes(config) {
  const allowlist = config.match(/\[allowlist\]([\s\S]*?)(?:\n\[|$)/);
  const regexBlock = allowlist?.[1].match(/regexes\s*=\s*\[([\s\S]*?)\]/);
  if (!regexBlock) throw new Error('Gitleaks allowlist regexes were not found');
  return [...regexBlock[1].matchAll(/'''([\s\S]*?)'''/g)].map(match => new RegExp(match[1]));
}

function apiKeyAssignment(value, index) {
  const assignmentName = ['api', 'key'].join('_');
  return `${assignmentName}_${index} = "${value}"`;
}

function databaseUrl(value) {
  return `postgresql://fixture_user:${value}@localhost:5432/fixture_db`;
}

function allowedFixtureText(values) {
  return `${values.flatMap((value, index) => [
    apiKeyAssignment(value, index),
    `DATABASE_URL_${index} = "${databaseUrl(value)}"`,
    `DATABASE_URL_${index}: "${databaseUrl(value)}"`,
    `\${DATABASE_URL_${index}:-${databaseUrl(value)}}`,
    `"DATABASE_URL_${index}": "${databaseUrl(value)}"`,
    `\${DATABASE_URL_${index}-${databaseUrl(value)}}`,
  ]).join('\n')}\n`;
}

function detectedFixtureText(values) {
  return `${values.map((value, index) => {
    switch (index % 6) {
      case 1: return `DATABASE_URL_${index} = "${databaseUrl(value)}"`;
      case 2: return `DATABASE_URL_${index}: "${databaseUrl(value)}"`;
      case 3: return `\${DATABASE_URL_${index}:-${databaseUrl(value)}}`;
      case 4: return `"DATABASE_URL_${index}": "${databaseUrl(value)}"`;
      case 5: return `\${DATABASE_URL_${index}-${databaseUrl(value)}}`;
      default: return apiKeyAssignment(value, index);
    }
  }).join('\n')}\n`;
}

function materializeGitleaksSemanticFixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitleaks-semantic-'));
  const allowedDirectory = path.join(root, 'allowed');
  const detectedDirectory = path.join(root, 'detected');
  fs.mkdirSync(allowedDirectory, { recursive: true });
  fs.mkdirSync(detectedDirectory, { recursive: true });
  fs.writeFileSync(path.join(allowedDirectory, 'placeholders.txt'), allowedFixtureText(documentedPlaceholders));
  fs.writeFileSync(path.join(detectedDirectory, 'variants.txt'), detectedFixtureText(prefixedAndSuffixedVariants));
  return { allowedDirectory, detectedDirectory, root };
}

module.exports = {
  documentedPlaceholders,
  materializeGitleaksSemanticFixtures,
  parseGitleaksAllowlistRegexes,
  prefixedAndSuffixedVariants,
};
