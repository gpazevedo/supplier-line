# H0 part 2: owner steps after Phase 1

Run these yourself, with your admin profile (called `admin` below), from the repo root. Agents never run them.

## 1. Deploy the persistent stack

```bash
cd packages/infra
AWS_PROFILE=admin AWS_REGION=us-east-1 pnpm exec cdk deploy PersistentStack --exclusively \
  -c alertEmail=you@example.com \
  -c expiresAt="$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)"
cd ../..
```

`expiresAt` only lets the app stack in the same CDK app synth; it is not deployed. The stack reuses the account's existing OIDC provider for `token.actions.githubusercontent.com` and does not create one. If the account has none, create it once first:

```bash
AWS_PROFILE=admin aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com
```

## 2. Confirm the alert email

Open "AWS Notification - Subscription Confirmation" and choose **Confirm subscription**. Budget alerts ($10 and $30) go to the same address and need no confirmation.

## 3. Set the access code

The stack creates `/supplier-line/demo-access-code` with a placeholder. Set the real code, the same value as the repo secret `DEMO_ACCESS_CODE` (the live smoke job sends that secret to the deployed host). `read -s` keeps it out of your shell history:

```bash
read -rs CODE && AWS_PROFILE=admin aws ssm put-parameter --region us-east-1 \
  --name /supplier-line/demo-access-code --type String --overwrite --value "$CODE"
```

## 4. Set the repo variables

```bash
out() {
  AWS_PROFILE=admin aws cloudformation describe-stacks --region us-east-1 \
    --stack-name supplier-line-persistent \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
gh variable set DEMO_ROLE_ARN --body "$(out DemoRoleArn)"
gh variable set TEARDOWN_ROLE_ARN --body "$(out TeardownRoleArn)"
gh variable set INFRA_ROLE_ARN --body "$(out InfraRoleArn)"
gh variable set ALERT_EMAIL --body you@example.com
```

`ALERT_EMAIL` is for `infra-deploy`, which must pass the same address, or it would drop the subscription.

## 5. Run the reaper self-test

```bash
AWS_PROFILE=admin AWS_REGION=us-east-1 pnpm reaper:selftest
```

It deploys `supplier-line-reaper-selftest`, tagged to expire in 5 minutes. Expect the "created" email now, then the "deleted" email within 15 minutes.

## 6. Connect admin website

Open the instance `supplier-line-<account-id>` from the Amazon Connect console (**Log in for emergency access**).

1. Confirm that Amazon Connect Customer is enabled for the instance.
2. **Conversational AI** → **Bots** → `supplier-line-po-status` → **Configuration** → locale **English (US)** → **Speech model** → **Edit**. Choose **Speech-to-Speech**, voice provider **Amazon Nova Sonic**, **Confirm**, then **Build language**.
3. The flow calls the bot's `live` alias, which serves a numbered version, not the draft you just built. In the Lex V2 console, create a new version of `supplier-line-po-status` from Draft and point the `live` alias at it. (Unverified: skip this if the Connect website already did it.)
4. **Routing** → **Flows** → `supplier-line-po-status` → the **Set voice** block: voice **Matthew**, **Override speaking style** → **Generative**. **Save**, then **Publish**.

The speech model is set by hand because setting it through an API or CloudFormation is unverified (V-09). An `infra-deploy` that changes the bot definition resets it, so repeat steps 2 and 3 after one.

Then tell the orchestrator the role ARNs are set.
