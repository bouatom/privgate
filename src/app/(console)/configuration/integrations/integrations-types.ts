export type DirectoryStatus =
  | { connected: false }
  | {
      connected: true;
      tenantName: string;
      tenantId: string;
      lastSyncAt: string | null;
      connectedBy: string;
    };

export type DeviceFlow = {
  state: string;
  userCode: string;
  verificationUri: string;
  interval: number;
};

export type AdFormState = {
  host: string;
  port: number;
  useTls: boolean;
  bindDn: string;
  password: string;
  baseDn: string;
  userFilter: string;
};
