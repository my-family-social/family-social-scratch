- [Overview](#overview)
- [Database Design](#database-design)
  - [Family Social Schema](#family-social-schema)
  - [Family Social Queries](#family-social-queries)
  - [The Drizzle Push](#the-drizzle-push)
  - [The Drizzle generate](#the-drizzle-generate)
- [State Management](#state-management)
- [Typescript](#typescript)
- [Discriminated Unions](#discriminated-unions)
  - [Checking the Success Condition](#checking-the-success-condition)
  - [Passing Argument to Component](#passing-argument-to-component)
  - [After Running SQL Query](#after-running-sql-query)
  - [Extacting the Type](#extacting-the-type)
- [Storing the Family Name in Authentication Cookie](#storing-the-family-name-in-authentication-cookie)
- [Page Protection](#page-protection)
- [Await All](#await-all)
- [Multi-Step Forms](#multi-step-forms)
- [Running PSQL Locally to Neon](#running-psql-locally-to-neon)
  - [Running MJS Script](#running-mjs-script)
- [TipTap Headless](#tiptap-headless)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Persistence](#persistence)
- [Amazon S3](#amazon-s3)
  - [Trial Account Bucket](#trial-account-bucket)
  - [Production Account Bucket](#production-account-bucket)
  - [The Family S3 Credentials Table](#the-family-s3-credentials-table)
- [Setting Up S3 Bucket with IAM User](#setting-up-s3-bucket-with-iam-user)
  - [Steps 1-3: Create IAM User](#steps-1-3-create-iam-user)
  - [Step 4: Test IAM User Access](#step-4-test-iam-user-access)
- [Referencing S3 from the EC2 Application](#referencing-s3-from-the-ec2-application)
- [Lint and Build Cleanup](#lint-and-build-cleanup)
- [Videos](#videos)
- [Component Code Size](#component-code-size)
  - [Hook Extraction](#hook-extraction)
  - [Hook Extraction versus Separate Routes](#hook-extraction-versus-separate-routes)
- [PWA Implementation Inventory](#pwa-implementation-inventory)
  - [Core App and Platform Files](#core-app-and-platform-files)
  - [PWA UI Components](#pwa-ui-components)
  - [Offline Queue and Sync Infrastructure](#offline-queue-and-sync-infrastructure)
  - [Server-side Idempotency for Replay Safety](#server-side-idempotency-for-replay-safety)
  - [Feature Upload Consistency Work](#feature-upload-consistency-work)
- [Setting up My Family Social on Safari](#setting-up-my-family-social-on-safari)
- [Troubleshooting Server Errors](#troubleshooting-server-errors)
  - [Reporting Incident](#reporting-incident)
  - [DB Logging Function](#db-logging-function)
    - [How To Use It](#how-to-use-it)
    - [An Example](#an-example)
    - [When to Use It](#when-to-use-it)
  - [Query Debug Workflow](#query-debug-workflow)
- [Unit Testing with vitest](#unit-testing-with-vitest)

---
# Overview
This markdown describes the design decisions implemented in the project and provides some insight into how various features were implemented.

# Database Design
Each feature will have tables to support it, beginning with the authentication tables, of which there were two. Going forward a brand new schema was created for Family Social. Currently **all** of the schema is defined in `@/features/auth/components/db/family-social-schema-tables.ts`. It made sense to put the (drizzle) schema definition in one place (in the `auth` folder). 

During development all schema is pushed to the Neon `family-social-dev` branch. Currently the production branch is empty. The original auth tables were still retained, to support the Auth.js template project. The `FAMILY_SOCIAL_DATABASE_URL` property is defined in the `@/.env.local` file.

## Family Social Schema
The ERD to support the login and family registration process is shown below (notes follow). 

![](./docs/erd-pngs/members-schema.png)

- The tables shown above are color coded where the **blue tables** are related to the authentication process and the **yellow tables** related to the family registration process.
- The `user` table is referenced for the login process but as the `family_name` is required as a part of the login, a foreign key to retrieve the `family_name` in the `family` table was added to the `user` table. 
- The `email` address exists in several tables and was denormalized for convenience. It is generally unique, except in the `member` table. An email address could exists for a member if they belong to more than one family.
- To not embed notifications and other options, they've been separated out to the `member_option` table. 
  - It is the result of a M:M implementation between `member` and `option_reference` tables.
  - When a family member initially registers, all of the options will be inserted into the `member option` table. Thereafter, only if an option is checked or unchecked wlll the table be updated.
  - The member profile prototype dialog is shown below to provide a picture of the data the tables must support.

    ![](./docs/pngs/member-profile.png)

## Family Social Queries

The queries related to authentication reside in `@/features/auth/components/db` and have a `queries-` prefix. 

## The Drizzle Push

As there two separate schemas, there are two separate schema files. As shown below, the `npx drizzle-kit push` command must then reference the relevant schema config file.

- **family_schema**: `npx drizzle-kit push --config=./drizzle-family.config.ts`
- **global_schema**: `npx drizzle-kit push --config=./drizzle-global.config.ts`

## The Drizzle generate

The `generate` command will create DDL for a schemas, and the output will be written to the `drizzle` directory. To generate **all** of the DDL for the schema, delete the subdirectories inside the drizzle directory. If not empty, it will attempt to generate a snapshot. 

- **family_schema**: `npx drizzle-kit generate --config=./drizzle-family.config.ts`
- **global_schema**: `npx drizzle-kit generate --config=./drizzle-global.config.ts`

# State Management

I implemented the React Context feature in the project (reference the `@/component/store/users-context.tsx` file).  It is not a viable option when using route groups which are absolute necessity to properly structure this next.js app.

- The provider was added to the root `layout.tsx` file in the app folder. The login was executed, displaying the state correctly. However, when it switched to `/my-account` in another route group, the state was lost.

- It only worked in the root layout and not in the route groups, so it will not be implemented.

- It was hard lesson but moved forward with querying the data based on email and the id captured in the session object.

# Typescript
After going through some of the learning associated with typescript (and still more learning to go), I realize how important it is to establish some rules around it's use.

- Discriminated (or tagged) unions are important but require special care. I have a separate section in this markdown on cases where it requires special handling.
- The type definitions are stored in separate `types` folder in various places.
  - For database related use: `@/components/db/types`
  - In each of the folders in `@/features`
    - `@/features/auth/types`
    - `@/features/family/types`

# Discriminated Unions
After creating varioius return types simply using optional properties, e.g. show below. The justification was to be able to see and a message if `success: false`. However, if `success:true` then the other attributes aren't really optional and you have to treat them as such.

```tsx
export type InsertFamilyReturn =
  success: false; 
  message?: string 
  id?: number;
  name?: string;
  createdAt?: Date;
```

I discovered the union feature that would allow me to be more precise in what was optional or required.

```tsx
export type InsertFamilyReturn =
  | { success: false; message: string }
  | {
      success: true;
      id: number;
      name: string;
      createdAt: Date;
    };
```

##  Checking the Success Condition

```tsx
const membersResult = await getAllFamilyMembers(memberKeyDetails.familyId);
  let familyMembers: CurrentFamilyMember[] = [];
  if (membersResult.success && membersResult.members) {
    familyMembers = membersResult.members.map((member) => ({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
    })) as CurrentFamilyMember[];
  }
```
Another case.

```tsx
let accountDetails: AccountDetails | null = null;
  if (memberDetails.success) {
    const accountDetails: AccountDetails = {
      accountDetails: {
        email: session?.user?.email as string,
        familyName: session?.user?.name as string,
        userId: userId as number,
        memberId: memberDetails.memberId as number,
        firstName: memberDetails.firstName as string,
        lastName: memberDetails.lastName as string,
        nickName: memberDetails.nickName as string,
        birthday: memberDetails.birthday as string,
        cellPhone: memberDetails.cellPhone as string,
        mfaActive: memberDetails.mfaActive as boolean,
      }
    }
```

## Passing Argument to Component
This case is like the one's in the previous section except it was interesting enough to warrant highlighting here: the `notifications` argument to `FamilyNotificationsForm`.

```tsx
  ...
  return (
    <main className="font-app h-[90vh]">
      <Card className="flex align-top w-[400] md:w-[700]">
        <CardHeader className=" text-base md:text-2xl bg-[#59cdf7] rounded-2xl text-center ">
          <CardTitle className="text-center font-bold size-1.2 p-2">My Account</CardTitle>
          <div className="p-1">
            <CardDescription className="text-xs">{ memberKeyDetails.familyName }</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <FamilyNotificationsForm notifications={ memberNotificationsResult.success ? memberNotificationsResult.notifications : [] } />
        </CardContent>
      </Card>
    </main>
  )
}
```

## After Running SQL Query
Check for null condition before assuming you can map any of the returned properties from the query.

```tsx
  if (!selectResult) {
    return {
      success: false,
      message: `Member details NOT FOUND for email ${email}`
    }
  }
  const memberDetails:GetMemberDetailsReturn = {
    success: true,
    email: selectResult.email!,
    userId: selectResult.userId!, 
    status: selectResult.status,
    firstName: selectResult.firstName, 
    lastName: selectResult.lastName,
    nickName: selectResult?.nickName!,
    birthday: selectResult.birthday,
    cellPhone: selectResult?.cellPhone!,
    familyId: selectResult.familyId!,
    familyName: selectResult.familyName!,
    memberId: selectResult.memberId,
    isFounder: selectResult.isFounder,
    mfaActive: selectResult.mfaActive as boolean,
  }  
  return memberDetails;
```

## Extacting the Type
An array of `notifications` were to be passed into this form component and required the use of the `Extract<>` to test the untion success boolean and then retrieve the notifications type.

```tsx
export default function FamilyNotificationsForm({ notifications }: { notifications: Extract<GetMemberNotificationsReturn, { success: true }>["notifications"] }) {
```  

# Storing the Family Name in Authentication Cookie
After fumbling around with how to add the family name used during authentication which entailed trying to configure NextAuth, I came up with the solution. When the authorized method in `auth.ts` finishes, the returned values constitute a `user` object that is then configured in the jwt and session callbacks, as shown below.

```tsx
export const { handlers, signIn, signOut, auth } = NextAuth({
  callbacks: {
    jwt({token, user}) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
      }
      return token;
    },
    session({session, token}) {
        session.user.id = token.id as string;
        session.user.name = token.name;
        return session;
    }
  }, //end callbacks
  ```
  The key was to return the following payload from authorize which then could be implemented in the above. 

  ```tsx
    return {
    id: validationResult.id,
    email: validationResult.email,
    name: validationResult.family,
```

I added a console.log message to display the session which produced the following output.

```bash
MainTablet->session:  {
  user: { name: 'HughlettFamily', email: 'aaa@whocares.com', id: '1' },
  expires: '2026-03-29T02:13:46.106Z'
```

# Page Protection
In addition to checking that pages that require a user to be logged in are accessible only after signing in, another necessary precaution is to require that family-account pages are only accessible by the family founder. In other words, if you are a family member but not the founder, stay out! 

Shown below is an example in the family founder pages. The `redirect` works on server-side pages (like `page.tsx`) that have some client-side component in them. 

```tsx
  const memberKeyDetails = await getMemberPageDetails();
  if (memberKeyDetails.isLoggedIn === false || memberKeyDetails.isFounder === false) {
    console.warn('Unauthorized access attempt to family account members page. Redirecting to home page.');
    redirect("/");
  }
```

# Await All
In a page where there are a number of async functions performed, use of the `Promise.all` method will execute them a block rather than serially. It will improve performance.

```tsx
const [memberDetails, result2fa, memberKeyDetails] = await Promise.all([
    getMemberDetails(userId),
    getUser2fa(email),
    getMemberPageDetails(),
  ]);
```

# Multi-Step Forms
Although they are user friendly they may implement very length form pages. Case in point in the Start a Family form. It consists of four steps and attempts to componentize pieces and parts of it proved harder than keeping it all withing a `form` element. Otherwise I stuck with one step forms elsewhere.

# Running PSQL Locally to Neon
Neon let's you export data from the database tables (one at a time) but the import of a CSV file into the table didn't work and their AI was not helpful. The AI did suggest using a psql command to do the copy.

1. Had to [install PostgreSql locally](https://www.postgresql.org/download/windows/) (database and tools) 
2. Set the Windows path to reference the bin directory in the installation folder (`"C:\Program Files\PostgreSQL\18\bin"`).
3. Run the following psql command to connect to the family social database:

   `psql "postgresql://****************?sslmode=require&channel_binding=require"`

    **Note**: important to use double-quotes after the `psql` keyword.

4. The `copy` command shown in the neondb connection prompt below. The first argument is the **table name** to copy to, and the second argument is the **path** to the CSV file and then some CSV parsing parameters: 

    neondb=> `\copy option_reference FROM 'C:\Users\ghughlett\Projects\my-projects\family-social-scratch\docs\csv-inserts\insert-option-reference-records.csv' DELIMITER ',' CSV HEADER`

5. The output is fairly terse, e.g.: `COPY 10` so go confirm the data copy made it to the table in Neon.

    **Note**: Use `\q` to exit the psql database prompt.

6. To execute a script from PostgreSql bin directory (`C:\Program Files\PostgreSQL\18\bin`):

    ```bash
    psql "postgresql://****************?sslmode=require&channel_binding=require" -f "C:\Users\gregh\Projects\family-social-scratch\docs\sql-scripts\backfill-discuss-family-activity.sql"
    ```

  **Note**: The taxonomy script normalizes `family_activity.action_type` values and should not reference an `activity_name` column (that column does not exist in the current schema).

  **Note**: If the script fails while wrapped in `BEGIN ... COMMIT`, PostgreSQL will issue a `ROLLBACK`; this means no changes were applied and it is safe to rerun the command after fixing the script.

  To confirm the above taxonomy script, run the following SQL on the family social Neon platform:

  ```bash
    SELECT conname, pg_get_constraintdef(oid) AS consrc
      FROM pg_constraint
      WHERE conrelid = 'family_activity'::regclass
      AND contype = 'c'
  ```

## Running MJS Script
These scripts are run in the project directory to populate tables. In the case below, the script will interrogate environment variables for S3 and will insert an entry into the family_s3_credentials table based on an input argument of family_id (28-thosecrazyhughletts)

```bash
 $env:S3_CREDENTIALS_MASTER_KEY="*************"; $env:FAMILY_SOCIAL_DATABASE_URL="**************"; $env:AWS_ACCESS_KEY_ID="YOUR_AWS_ACCESS_KEY_ID"; $env:AWS_SECRET_ACCESS_KEY="YOUR_AWS_SECRET_ACCESS_KEY"; $env:AWS_S3_BUCKET_NAME="thosecrazyhughletts"; $env:AWS_REGION="us-east-2"; npm run seed:family-s3 -- --family-id 28 --rotate
 ```

  **Note**: The s3 master key and psql database credential above have been obfuscated.


# TipTap Headless
The Poetry Nook and The Kitchen features will implement a rich text editor. It will be used to a greater degree in the The Kitchen rather than the Poetry Nook. Saving the content will use a JSON output rather than HTML. 

[TipTap Headless](https://tiptap.dev/product) is a free version of their editor that allows you to build an an RTE into different client (e.g. React) and it supports typescript. As it is headless it will require Tailwindcss to pretty up the RTE interface.

## Installation

Below are various `npm` installation commands.

```bash
npm install @tiptap/core @tiptap/pm @tiptap/starter-kit
npm install @tiptap/react
```

## Configuration
Below is a sample tsx file.

```tsx
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

const Tiptap = () => {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p>Hello World! 🌎</p>',
  })

  return <EditorContent editor={editor} />
}
```

## Persistence
Saving via database endpoint shown below.

```tsx
// Save the editor content to a database
fetch('/api/editor/content', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(editor.getJSON()),
})
```
Restoring the content from endpont is shown below.

```tsx
// Restore the editor content from a database
fetch('/api/editor/content')
  .then(response => response.json())
  .then(data => {
    editor.setContent(data)
  })
  .catch(error => {
    console.error('Error fetching editor content:', error)
  })
```

# Amazon S3
A storage service is needed as there will be a great many files uploaded (and downloaded) in the application. 

The S3 client install command line in VS Code is: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`

The plan is to create an S3 bucket for each family subscription accounts, to provide isolation data protection. Trial accounts however run within one bucket. When (if) they upgrade to a subscription, then a lift and shift will be performed on the trial account S3 content.

(The same will be true for the family database tables; more on that later).

## Trial Account Bucket
The trial account bucket is currently in the `thosecrazyhughletts` S3 bucket. This will be renamed to `trialaccountbucket` sometime in the future. The S3 bucket was created in the `us-east-2` region, where the current EC2 server is running. There is no need for  AWS_ACCESS_KEY or AWS_REGION environment variables.

The naming of the bucket will be a conversion of the family name to lowercase. The `family-social-s3-user` was defined in AWS IAM with `AmazonS3FullAccess` permission.

Within the trial-account bucket there is a high-level folder: `family-##` that contains the familyId of the the trial account. Within the family folder, then the following folders were created to store the content for each of the features. 

![](docs/pngs/s3-bucket-folders.png)

Members who want to add a profile picture can select the file and upload it to the `members` folder. TV, Movies, Foodies, and Threads are other features where images come into play.

## Production Account Bucket
When a family upgrades from a trial to a subscription account, a separate S3 bucket will be created. The S3 artifacts in the trial `bucket/family-##` will be moved to the new subscription bucket.

## The Family S3 Credentials Table
The table described below is used to configure the S3 credentials for a family. For the *trial* family account the same credential is duplicated. However, in a *subscription* account, there is a separate database and table setup for each family. In the latter case, there will only be one entry in the table.

```sql
export const familyS3Credentials = pgTable("family_s3_credentials", {
  id: serial("id").primaryKey(),
  encryptedAccessKey: text("encrypted_access_key").notNull(),
  encryptedSecretKey: text("encrypted_secret_key").notNull(),
  bucketName: text("bucket_name").notNull(),
  region: text("region").notNull().default("us-east-2"),  
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
}, (table) => [
  index('family_s3_credentials_family_id_idx').on(table.familyId),
  index('family_s3_active_credential_idx').on(table.familyId, table.isActive),
]);
```

# Setting Up S3 Bucket with IAM User
There are four steps, as listed below. The last step assumes you have installed the [AWS CLI interface](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html). In the example below it was a user to access the `family-social-support-bucket` where the My Family Social videos are to stored.

1. Create IAM User. 
2. Attach IAM policy to provide full specific S3 permissions.
3. Create user access key and secret
4. Test IAM user access to the bucket files

## Steps 1-3: Create IAM User
1. Create IAM user `family-social-s3-user`.
2. In the **Permissions** tab, attach policy `AmazonS3FullAccess`
3. In the **Security credentials** tab, create an access key and secret. Be sure to download the CSV file with the key and secret to a secure location. 

## Step 4: Test IAM User Access
Use aws CLI to test the credential. (In the text below the key and secret are obfuscated).
1. Run `aws configure` command in a terminal. There will be four prompts, as shown below.


2. Run the aws s3 command shown below which lists the contents in the bucket

  ```bash
  C:\Users\gregh>aws s3 ls s3://family-social-support-bucket/app-help-videos/
  2026-06-03 11:38:08          0
  2026-06-03 11:39:39   18204056 PhotoGalleries-Overview.mp4  ``` 
  ```

# Referencing S3 from the EC2 Application
There are other IAM configurations needed for EC2 to access S3 using an IAM user. Shown below is the **Security** tab setting for the EC2 instance which reference an IAM role of `SocialServer-EC2-Role`.

![](docs/pngs/ec2-security-for-iam-access.png)

The `SocialServer-EC2-Role` definition below provides two permission policies associated to it: 
1. `AmazonSSMManagedInstance Core`
2. `SSM-SecureRead-SocialServer`

![](docs/pngs/iam-role-for-ssm.png)

The 2nd policy shown above is needed as it provides access by the Systems Manager `Parameter Store` which contains encrypted secrets needed in EC2.

![](docs/pngs/iam-ssm-policy-details.png)


**Notes**:
1. /prod/social-server/S3_CREDENTIALS_MASTER_KEY: decryption master key for S3
2. AUTH_SECRET: used for Auth.js Credentials provider
3. RESEND_API_KEY: used for Family Social outbound emails

![](docs/pngs/aws-systems-manager-param-store.png)


# Lint and Build Cleanup
There is a concept called `lint debt` which arises from unresolved warning and errors the linter finds. Rather than waiting a long time between reducing the `lint debt` follow the practices below.

* Before merging and committing to the main branch, run the `npm run build` command to catch any unseen errors that lurk in the files.

  * The production build on the EC2 server may fail due to packages that are installed locally during development. Simply run the `npm i` command for the missing module.

* During development it's a good practice to run various commands to check for lint and typescript errors: 

  * `npm run link -- file1 file2`   <<<files will be within src/* directories (use wildcards)
  * `npx tsc --noEmit`              <<<noEmit will suppress generation of output files
  * `npx eslint . --quiet`          <<<eslint check

# Videos
With S3 now nicely supported in Family Social, videos will be added to the repertoire. The first implementation will be on the support side. Rather than having a lot of text, how about short and sweet videos to explain things.

The [next-video](https://next-video.dev/) module will be used for the video access on S3 and it provides a customizable player to boot. 

The support schema tables to support the video appears below. 

![](./docs/pngs/video-schema.png)

# Component Code Size
I noticed the Book home page had > 1000 lines of code while the Movie was much less. There are two main reasons:

**1. Architecture difference — where editing lives**

The biggest driver. The Books page handles add and edit directly in dialogs on the home page, which requires:

A full draft state object + setDraft throughout
handleSave, setSavePhase, setPendingSelectedBookId, startSaveTransition
An editable TipTap editor with useEditor, two useEffects to sync it, and link dialog state (isLinkDialogOpen, linkValue, linkError, openLinkInNewTab, applyLink, openLinkDialog, normalizeLinkUrl)
ToolbarButton, RichTextToolbar, and RichTextField components defined inline in the same file
The Movies page delegates editing entirely to a separate route (/movies/add-movie?id=...). The home page only needs a read-only viewer dialog. The MovieViewer is just a static TipTap instance — no save logic, no link dialog, no toolbar.

**2. Code density

The Movies file is heavily compressed — the entire finder table, all table rows, the reactions panel, and the comments section are each written as single long lines. If the Books page were formatted the same way, it would appear much shorter. The Books page consistently formats each JSX element across multiple lines.

**Summary:**

Books	Movies
Add/Edit	In-page dialog	Separate route
Rich editor	Editable + toolbar + link dialog	Read-only viewer
Inline components	ToolbarButton, RichTextToolbar, RichTextField	None
Code style	Multi-line JSX	Heavily compressed
The complexity difference is real but smaller than the line count suggests. The Books page made a different architectural choice that pulled the entire edit workflow into the home file.

## Hook Extraction
A number of component pages have gotten quite large, like the TV and Movie home pages and interestingly, the Book home page. The solution is not to simply move the inner components (like the Dialog components) to separate file as that would entail a lot of prop drilling between the home page and the newly separated components. Instead, hook extraction is cleaner to componentinzing the functionality.

Hook extraction means moving a cluster of related state variables and the functions that operate on them out of the component and into a custom use... function in a separate file. The custom hook returns only what the component needs to render.

Example using the link dialog state from your file:

Instead of this sitting in BooksHomePage:

```tsx
const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
const [linkValue, setLinkValue] = useState("");
const [linkError, setLinkError] = useState<string | null>(null);
const [openLinkInNewTab, setOpenLinkInNewTab] = useState(true);

function normalizeLinkUrl(value: string): string | null { ... }
function openLinkDialog() { ... }
function applyLink() { ... }

const normalizedLinkPreview = linkValue.trim() ? normalizeLinkUrl(linkValue) : null;
```

You'd create src/features/books/hooks/use-link-dialog.ts:

```tsx
export function useLinkDialog(analysisEditor: Editor | null) {
  const [isOpen, setIsOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [openInNewTab, setOpenInNewTab] = useState(true);

  function normalizeLinkUrl(...) { ... }
  function open() { ... }
  function apply() { ... }

  return {
    isOpen, linkValue, setLinkValue, linkError,
    openInNewTab, setOpenInNewTab,
    normalizedPreview: linkValue.trim() ? normalizeLinkUrl(linkValue) : null,
    open, apply,
  };
}
```

Then in BooksHomePage:

```tsx
const linkDialog = useLinkDialog(analysisEditor);
```

Once the logic for the link dialog lives in useLinkDialog and the book dialog logic lives in useBookDialog, the extracted dialog components have a clean, small prop interface — just the hook's return value — rather than needing 10+ individual props passed down. That's what makes the file split genuinely cleaner rather than just moving clutter.

## Hook Extraction versus Separate Routes

In the Book home page architecture does it make sense to adopt a separate route for Adding and Editing a book, give the difference that the Add and Edit Book are in-page dialogs? Is having a separate route for Add and Edit Book preferrable to a hook extraction approach in the Book home page?

When a separate route makes more sense:

The form is complex enough to warrant its own page (the Movie add form with image upload, multiple tag types, site URL, TipTap editor is a full-page experience)
The user benefits from a dedicated URL they can bookmark or navigate back to
The edit experience is substantially different from the list/browse experience
When in-page dialogs make more sense:

The add/edit is quick and lightweight relative to the list page
You want the user to stay in context — pick a book, edit it, stay on the same page
The data is simple enough that a dialog doesn't feel cramped
For the Books feature specifically:

The book form (title, author, year, language, analysis, tags) is meaningfully simpler than the Movie form. A book dialog fits naturally. The current UX — select a book from the directory, click View or Edit, interact in a dialog, return to the directory — is a coherent workflow that a separate route would actually interrupt. You'd navigate away, save, and come back to a page that has lost your scroll position and search state.

# PWA Implementation Inventory

## Core App and Platform Files
- `src/app/manifest.ts`: Web app manifest served as /manifest.webmanifest. Current icon uses /images/pwa-phone-logo.png at 512x512.
- `src/app/layout.tsx`: Global metadata includes applicationName, manifest, appleWebApp, and viewport themeColor; mounts PwaRegister.
- `public/sw.js`: Service worker precaches /offline and app logo, handles navigation requests with offline fallback.
- `src/app/offline/page.tsx`: Offline fallback route shown when navigation fails offline.
- `next.config.ts`: Headers for /sw.js and /manifest.webmanifest with no-cache behavior.

## PWA UI Components
- `src/components/pwa/pwa-register.tsx`: Registers the service worker in secure production contexts by default. Set NEXT_PUBLIC_PWA_ENABLED=false at build time to disable it.
- `src/components/pwa/install-prompt.tsx`: Handles beforeinstallprompt flow and iOS install guidance UI.
- `src/components/pwa/sync-status-banner.tsx`: Shows online or offline state, queue count, and manual Sync now action.
- `src/app/(family)/layout.tsx`: Renders InstallPrompt and SyncStatusBanner in the family shell.

## Offline Queue and Sync Infrastructure
- `src/lib/pwa-background-sync.ts`: LocalStorage-backed queue store, queue update events, sync-now event dispatch, queue metrics, and client request id generation.
- Queue coverage includes:
  - Foodies recipe save and recipe comments
  - Gallery selected album sync, album comments, and album updates
  - Cross-feature comments (books, movies, music, poetry, tv)
  - Discussion initial posts

## Server-side Idempotency for Replay Safety
- `src/components/db/schema/family-social-schema-tables.ts` and `src/components/db/schema/family-social-schema.ts`: Adds and exports `pwaMutationRequest` table.
- `docs/sql-scripts/create-pwa-mutation-request-table.sql`: Migration script for pwa_mutation_request table.
- Query modules use clientRequestId plus pwaMutationRequest insert with conflict-ignore semantics to avoid duplicate writes on replay.

## Feature Upload Consistency Work
- Image upload surfaces now align on PNG/JPEG-only policy and proxy upload transport in foodies, galleries, tv, movies, music, threads, and member image upload manager.

# Setting up My Family Social on Safari

- If you have Chrome on the iPhone then the installation of the PWA app is just a matter of selecting `Install` from the browser URL.

- If you're stuck with Safari then the steps below will get it done.

  1. Add https://dev.my-family-social.com to Safari and open
  2. Wait till app responds (could be 5-30 seconds)
  3. Down at the bottom, click on the three dots
  4. Click on the Share button
  5. If you see Add to Home Screen, select that
  6. Otherwise
     i.   scroll all the way to the bottom
     ii.  select Edit Actions
     iii. In the Safari list, select Add to Home Screen
     iv.  If you see Copy action, remove it.
  7. Back on the Share screen, click on the +Add to Home Screen to add it.
  8. Open My Family Social app on your home screen and login.

# Troubleshooting Server Errors

## Reporting Incident 
Need to have a way for support to enter incident in a Support system consisting of the following.

- Date/time:
- Environment: local | staging | production
- Feature: books | foodies | other
- User impact summary:
- Reporter:

## DB Logging Function
Implement a means to report the error in the logs with sufficient context to help troubleshoot issues when they arise. 

**Note**: The `db-error-logger.ts` file resides in the `src/components/db/sql` directory where all of the queries.*.ts files reside.

### How To Use It

- import `logDbQueryError` from `@sql/db-error-logger.ts`
- Wrap DB queries in try/catch 
- Add `logDbQueryError` in catch block (see example below)

### An Example

  ```tsx
  ...
  import { logDbQueryError } from './db-error-logger';
  ...
  export async function getBooksHomePageData(familyId: number, memberId?: number)
    : Promise<BooksHomePageDataReturn> {
    try {
      const [books, bookTagsResult, clubs] = await Promise.all([
        loadBooksHomeBooks(familyId, undefined, memberId),
        getBookTagReferences(),
        getFamilyClubs(familyId),
      ]);

      return {
        success: true,
        books,
        bookTags: bookTagsResult.success ? bookTagsResult.bookTags : [],
        clubs,
      };
    } catch (error) {
      logDbQueryError('books.getBooksHomePageData', error, { familyId, memberId });
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Error loading book besties home page data',
      };
    }
  }
  ```
### When to Use It
The above patter is best applied in one of these scenarios.

1. An exported query/service function that a page or server action calls directly
2. A server action in src/app/(features)/(books)/books/actions.ts/(books)/books/actions.ts) or src/app/(features)/(foodies)/foodies/actions.ts/(foodies)/foodies/actions.ts)
3. A top-level workflow function that coordinates several DB reads/writes


## Query Debug Workflow
- Locate failing scope in logs
- Open related query module
- Identify boundary `try/catch`
- Ensure `logDbQueryError` includes context fields:
  - `familyId`
  - `memberId`
  - entity id (`bookId`/`recipeId`)
  - action/status where relevant

```bash
[DB_QUERY_FAILED] {
  requestId: 'debug-live-request-id',
  scope: 'books.getBooksHomePageData',
  message: 'Failed query: select "book_source" from "family_schema"."book" where "fk_family_id" = $1 params: 28',
  stack: 'Error: Failed query: select "book_source" from "family_schema"."book" where "fk_family_id" = $1 params: 28\n' +
    '    at C:\\Users\\gregh\\projects\\family-social-scratch\\src\\components\\db\\sql\\db-error-logger.debug.test.ts:9:21\n' +
    '    at AsyncLocalStorage.run (node:internal/async_local_storage/async_context_frame:63:14)\n' +
    '    at Module.withRequestCorrelation (C:\\Users\\gregh\\projects\\family-social-scratch\\src\\components\\db\\sql\\request-correlation.ts:28:36)\n' +
    '    at C:\\Users\\gregh\\projects\\family-social-scratch\\src\\components\\db\\sql\\db-error-logger.debug.test.ts:8:11\n' +
    '    at file:///C:/Users/gregh/projects/family-social-scratch/node_modules/@vitest/runner/dist/index.js:146:14\n' +
    '    at file:///C:/Users/gregh/projects/family-social-scratch/node_modules/@vitest/runner/dist/index.js:533:11\n' +
    '    at runWithTimeout (file:///C:/Users/gregh/projects/family-social-scratch/node_modules/@vitest/runner/dist/index.js:39:7)\n' +
    '    at runTest (file:///C:/Users/gregh/projects/family-social-scratch/node_modules/@vitest/runner/dist/index.js:1056:17)\n' +
    '    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n' +
    '    at runSuite (file:///C:/Users/gregh/projects/family-social-scratch/node_modules/@vitest/runner/dist/index.js:1205:15)',
  familyId: 28,
  memberId: 4,
  debugMode: true
```

# Unit Testing with vitest
Using Vite dev server to transform your files during testing, enables the creation of a simple runner that doesn't need to deal with the complexity of transforming source files and can solely focus on providing a test runner that uses the same configuration of your App (through vite.config.js), sharing a common transformation pipeline during dev, build, and test time.

Vitest is optimal for headless testing where other tools like Cypress or Playwright are better for browser based test. Vitest in this project will be utilized to provide regression tests for the server-side query code.

Vitest files have `test` or `spec` defined in them, as the simple example below illustrates.

**sum.ts**
  ```tsx
  export function sum(a, b) {
    return a + b
  }
  ```
**sum.test.ts**
  ```tsx
  import { expect, test } from 'vitest'
  import { sum } from './sum.js'

  test('adds 1 + 2 to equal 3', () => {
    expect(sum(1, 2)).toBe(3)
  })
  ```
**Running a test**

Go to directory where there is a test: *`cd src\app\(features)\(books)\books`*
  ```bash
    npx vitest run .\actions.correlation.test.ts --coverage
  ```
