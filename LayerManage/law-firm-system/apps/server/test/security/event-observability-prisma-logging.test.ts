import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import ts from 'typescript';

test('shared application Prisma client leaves direct stdout and stderr logging disabled', () => {
  const contextPath = path.resolve(__dirname, '../../app/extend/context.ts');
  const source = fs.readFileSync(contextPath, 'utf8');
  const sourceFile = ts.createSourceFile(contextPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const constructions: ts.NewExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'PrismaClient') {
      constructions.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.equal(constructions.length, 1, 'context extension must own exactly one shared Prisma client construction');
  const [construction] = constructions;
  const options = construction.arguments?.[0];
  if (options === undefined) return;
  assert.ok(ts.isObjectLiteralExpression(options), 'shared Prisma client options must remain statically auditable');
  const directLogProperty = options.properties.find(property => property.name
    && ts.isIdentifier(property.name)
    && property.name.text === 'log');
  assert.equal(
    directLogProperty === undefined,
    true,
    'shared Prisma client must not configure direct stdout or stderr logging',
  );
});
