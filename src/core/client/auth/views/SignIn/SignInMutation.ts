import { pick } from "lodash";
import { Environment } from "relay-runtime";

import { CoralContext } from "coral-framework/lib/bootstrap";
import { createMutationContainer } from "coral-framework/lib/relay";
import { signIn, SignInInput } from "coral-framework/rest";

export type SignInMutation = (input: SignInInput) => Promise<void>;

export async function commit(
  environment: Environment,
  input: SignInInput,
  { rest, clearSession }: CoralContext
) {
  const result = await signIn(rest, pick(input, ["email", "password"]));
  await clearSession(result.token);
}

export const withSignInMutation = createMutationContainer("signIn", commit);
