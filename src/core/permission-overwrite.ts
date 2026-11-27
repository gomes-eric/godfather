export interface PermissionOverwrite {
  id: string;
  type: 'role' | 'member';
  allow: bigint;
  deny: bigint;
}
