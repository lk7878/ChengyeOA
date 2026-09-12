UPDATE permission SET name = '云端知识库', version = version + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE code = 'menu.knowledge' AND name <> '云端知识库';
