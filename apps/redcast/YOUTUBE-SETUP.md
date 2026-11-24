# YouTube Sign-in: One-Time Setup

Do this once, on any computer, with the church's Google account. After that, the app signs in with one button and creates each Sunday's broadcast by itself.

**Why is this needed?** Google requires every program that talks to YouTube to be registered. There is no cost. You are registering Church Switcher as the church's own private program. The menu names in Google's console change now and then, so if a name below is slightly different, look for the closest match.

## Part 1: Register the app with Google (about 15 minutes)

1. Go to **console.cloud.google.com** and sign in with the church's Google account (the one that owns the YouTube channel).
2. Click the project picker at the top and choose **New project**. Name it `Church Switcher` and create it.
3. Open **APIs & Services > Library**, search for **YouTube Data API v3**, and click **Enable**.
4. Open **APIs & Services > OAuth consent screen** (it may be called **Google Auth Platform**).
   - User type: **External** (or **Internal** if the church uses Google Workspace, which is simpler).
   - App name: `Church Switcher`. Add the church email as the support and contact email.
   - Add this scope: `.../auth/youtube` (it appears as "Manage your YouTube account").
   - Under **Test users**, add the church Google account.
5. **Important:** while the app is in "Testing" status, Google makes the sign-in expire after **7 days**, so you would have to sign in again every week. To avoid that, click **Publish app** (set it to "In production"). Google will show a "has not been verified" warning on sign-in. For a private app used by one church, you click **Advanced** and then **Go to Church Switcher** to continue. That is expected.
6. Open **APIs & Services > Credentials > Create credentials > OAuth client ID**.
   - Application type: **Desktop app**. Name: `Church Switcher Desktop`.
   - Copy the **Client ID** and the **Client secret**.

## Part 2: Connect the app (2 minutes)

1. In Church Switcher, press **Setup**, then **Advanced**.
2. Under **YouTube connection**, paste the Client ID and Client secret, and press **Save**.
3. Go back to **Setup**. In the YouTube card, press **Sign in with YouTube**.
4. Your web browser opens. Choose the church account, allow access, and come back to the app. It should say **Connected as (your channel name)**.
5. Set the **Stream title**, **Description**, and **Who can watch** once. Use tokens like `{longdate}`. The line under the title shows what it will become today.

## Using it

- Press **START STREAM**. The app creates a new YouTube broadcast from your template, uses the same permanent stream key every time, and starts sending video. YouTube starts the broadcast on its own when it sees the video, and ends it when the stream stops.
- Title and description tokens: `{date}` Nov 19, 2026, `{longdate}` Thursday, November 19, 2026, `{shortdate}` 11/19/2026, `{iso}` 2026-11-19, `{weekday}`, `{month}`, `{day}`, `{year}`, `{time}` 9:30 AM, `{service}` Morning, Afternoon or Evening.
- Your own channel must have live streaming turned on. If it has never been used, turn it on in YouTube Studio (Create > Go live). The first time can take up to 24 hours to be approved.

## If something goes wrong

- **"Live streaming is not turned on":** do the YouTube Studio step above and wait.
- **Sign-in says access blocked or app not verified:** repeat step 5 (Publish app) or make sure the church account is listed under Test users.
- **You have to sign in again every week:** the app is still in Testing status. Publish it (step 5).
- **Nothing happens when you press Sign in:** make sure the Client ID and secret were saved (Advanced shows "Google client saved").
- You can always use the **Manual stream URL and key** option in Advanced as a backup.
