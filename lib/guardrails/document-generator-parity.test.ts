import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatorKeys } from "@/lib/documents/generators";
import { documentTones } from "@/lib/documents/generators/types";

// The generator catalog lives in TypeScript, but doc_type is pinned by a CHECK
// constraint in Postgres. When the two disagree the failure is silent in dev
// (where nobody runs the new generator) and total in production (every insert
// for the new kind is rejected, after the model has already been paid for).
//
// This test reads the newest migration that regenerates the constraint and
// compares it to the registry. Adding a generator without the migration fails
// here, at build time, instead of at 2am in front of a client.
//
// If this fails: add the key to BOTH constraints in a new migration that
// regenerates them in full, following the idiom in
// 20260818210000_document_generator_registry.sql.

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

const CONSTRAINED_TABLES = ["document_builder_generations", "document_builder_drafts"] as const;

/**
 * Comments are stripped before anything is matched. Every migration here
 * carries its own ROLLBACK block, and that block restates the constraint it
 * would restore — so a naive search finds the commented-out OLD definition
 * first and reports the new keys as missing.
 */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** The most recent migration that regenerates the given constraint, by filename order. */
function latestMigrationDefining(constraint: string): { file: string; sql: string } {
  const matches = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")) }))
    .filter((entry) => entry.sql.includes(`add constraint ${constraint}`));

  const latest = matches.at(-1);
  if (!latest) throw new Error(`No migration adds the constraint ${constraint}.`);
  return latest;
}

/**
 * Pulls the quoted values out of the `check (col in (...))` block that follows
 * the named constraint. Expects comment-stripped SQL.
 */
function keysInConstraint(sql: string, constraint: string): string[] {
  const start = sql.indexOf(`add constraint ${constraint}`);
  if (start === -1) return [];
  const checkStart = sql.indexOf("check (", start);
  if (checkStart === -1) return [];

  let depth = 0;
  let end = checkStart;
  for (let i = sql.indexOf("(", checkStart); i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  return [...sql.slice(checkStart, end).matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
}

describe("document generator registry matches the database", () => {
  for (const table of CONSTRAINED_TABLES) {
    const constraint = `${table}_doc_type_check`;

    it(`${table}: the constraint allows exactly the registry's keys`, () => {
      const { file, sql } = latestMigrationDefining(constraint);
      const allowed = keysInConstraint(sql, constraint);

      const missingFromDb = generatorKeys.filter((key) => !allowed.includes(key));
      const missingFromRegistry = allowed.filter((key) => !generatorKeys.includes(key));

      expect({ file, missingFromDb, missingFromRegistry }).toEqual({
        file,
        missingFromDb: [],
        missingFromRegistry: [],
      });
    });

    it(`${table}: the constraint has no duplicate keys`, () => {
      const { sql } = latestMigrationDefining(constraint);
      const allowed = keysInConstraint(sql, constraint);
      expect(allowed.length).toBe(new Set(allowed).size);
    });
  }

  it("the tone constraint allows exactly the tones the app can produce", () => {
    const constraint = "document_builder_drafts_tone_check";
    const { sql } = latestMigrationDefining(constraint);
    const allowed = keysInConstraint(sql, constraint);

    expect([...allowed].sort()).toEqual([...documentTones].sort());
  });
});
