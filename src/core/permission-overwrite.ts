/** A channel permission overwrite as plain data: who it is for and the bits it allows or denies. */
export interface PermissionOverwrite {
  /** A role id, or a member id for `type: 'member'`. */
  id: string;
  type: 'role' | 'member';
  allow: bigint;
  deny: bigint;
}
