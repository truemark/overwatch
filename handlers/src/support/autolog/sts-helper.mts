import {GetCallerIdentityCommand, STSClient} from '@aws-sdk/client-sts';

const client = new STSClient({});
let ACCOUNT_ID: string | undefined;

export async function getAccountId(): Promise<string> {
  if (ACCOUNT_ID) {
    return ACCOUNT_ID;
  }
  const response = await client.send(new GetCallerIdentityCommand({}));
  ACCOUNT_ID = response.Account;
  return ACCOUNT_ID!;
}
