# Private Render Deployment

This repository includes a `render.yaml` Blueprint for a single free Node web service. The application is adapted for external deployment: it serves the built React interface, runs the public extraction API, and does not depend on Manus-only OAuth, database, or storage services.

## Required Render secrets

Add these values only in the Render service’s **Environment** page. Do not add either value to GitHub, `render.yaml`, or a committed `.env` file.

| Key | Purpose |
|---|---|
| `ANCHOR_API_KEY` | Connects the server to the protected browser-session service that reads the detail page and episode player data. |
| `APP_ACCESS_PASSWORD` | Optional but strongly recommended. When set, the hosted site is protected by a browser password prompt; enter any username and this password. |

## Deploy steps

1. Sign in to Render and select **New → Blueprint**.
2. Connect GitHub, then select the private `keovoin/drama-stream-extractor` repository and its `main` branch.
3. Render detects `render.yaml`. Review the `drama-stream-extractor-private` web service, then choose **Deploy Blueprint**.
4. When Render asks for the secret values, provide `ANCHOR_API_KEY` and a strong `APP_ACCESS_PASSWORD`.
5. After the deployment finishes, open the generated `onrender.com` URL. The service prompts for the application password before displaying the extractor.

## Free plan behavior

The free service can take roughly a minute to wake after 15 minutes without traffic. Each successful extraction keeps its temporary job state only for the active browser session; no user URLs or workbooks are retained after completion.

## References

1. [Render Blueprints](https://render.com/docs/infrastructure-as-code)
2. [Render environment variables and secrets](https://render.com/docs/configure-environment-variables)
3. [Render free web services](https://render.com/docs/free)
