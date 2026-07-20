const OPTIONAL_ROLES = ["anon", "authenticated", "service_role"];

/**
 * Finds ACL statements that reference Supabase-specific roles without a
 * matching to_regrole(...) guard. Production may run on plain Postgres/Neon,
 * where these roles do not exist.
 */
export function findUnguardedRoleStatements(sql) {
  const guardStack = [];
  const violations = [];

  for (const [index, rawLine] of sql.split(/\r?\n/).entries()) {
    const statement = rawLine.replace(/--.*$/, "").trim();
    if (!statement) continue;

    const roleGuard = statement.match(
      /^if\s+to_regrole\(\s*'?(anon|authenticated|service_role)'?\s*\)\s+is\s+not\s+null\s+then\b/i,
    );

    if (roleGuard) {
      guardStack.push(roleGuard[1].toLowerCase());
      continue;
    }

    if (/^if\b.*\bthen\b/i.test(statement)) {
      guardStack.push(null);
      continue;
    }

    if (/^end\s+if\s*;/i.test(statement)) {
      guardStack.pop();
      continue;
    }

    for (const role of OPTIONAL_ROLES) {
      if (!new RegExp(`\\b${role}\\b`, "i").test(statement)) continue;

      const isDynamicAcl = /^execute\b/i.test(statement);
      const hasMatchingGuard = guardStack.includes(role);

      if (!isDynamicAcl || !hasMatchingGuard) {
        violations.push({ line: index + 1, role, statement });
      }
    }
  }

  return violations;
}
