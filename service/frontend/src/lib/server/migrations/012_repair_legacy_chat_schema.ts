import { migration as branchRootsMigration } from './007_branch_roots';
import { migration as llamacppParityMigration } from './004_llamacpp_parity';
import type { Migration } from './helpers';

export const migration: Migration = {
  id: '012_repair_legacy_chat_schema',
  description:
    'Repair legacy chat schema drift when older databases recorded parity migrations without all columns',
  up: async () => {
    await llamacppParityMigration.up();
    await branchRootsMigration.up();
  }
};
