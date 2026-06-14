# App specification

# General idea
The app is a note taking app, that relies on markdown. The name is Jnote.

# Stack
- vanilla javascript in frontend
- nodejs in backend

# Deployment
- prepare docker compose manifest (dont use docker-compose but docker compose in readme)
- set container_name and hostname ( and services names) to jnote_frontend and jnote_backend
- use restart policy unless stoppeed
 

# Architecture requirements:
- I want sqlite database, but with option to connect also postgres or maybe even some cloud storage options, so make  universal storage connector for sqlite for now ( i can add another connector later)
- you need to write very concise readme - dont user filler words, write only the essential informationa about the architecture and when ai models need to know in the future when changing it
- use best practices, but make the architecture simple so in future ai models can edit it easily

# Accounts requirements
- initially when app is built, admin account is created with generated password, that is written in console ( can be overridden in docker compose as env variable)
- i want internal accounts + support for login with google, each account needs to be approved by admin before can be used
- admin can add admin role to any user

# App functional requirements
- split screen into left side (sidebar) and right side(note view). Add also minimal narrow topbar where you can place icons like logout and dark/light mode
- On left side i want sidebar(can be hidden in mobile view) with folders and subfolders - when i click i see the notes behind it on the same sidebar, but when i click note, then it shows on right side
- App needs to have folders ( and nested folders for the notes)
- App needs to have possibvility to assign tags and search by tags
- Need to have easy and flexibe search options by text, similar to what we have in onenote so: when user types in search window, then with each keypress the found results update - as quickly as possible - make this efficient and easy to use, then when clicked on searched note it opens instantly in right side; search box should be constantly visible in top bar and search results shown on left side (when search is empty then standard list of folders/notes is shown on left, but during search it shows only matched things)
- App needs to show well in both browser and mobile browser
- App needs to display markdown text as nicely formatted html
- Need to have shortcut buttons to make selected text bold, or increase, decrease heading level or to put code fragment etc - all that works well with markdown
- need to have option to export one note ( download .md file) or all notes ( download all notes zipped  - md files in folders and subfolders)
- need to have option to import notes - accepts single .md files or zipped file with folder structure with .md files
- normally all files should be sorted by name A to Z, but with option to sort by modification and creation date

# Final instructions
Dont try to deploy or do docker commands.

# Added later
Features requested after the initial spec:

- **Programmatic API via personal access tokens** — `Authorization: Bearer jnote_pat_…` works alongside the cookie session. Mint from the user menu → API tokens.
- **Admin user management** — disable, enable, delete accounts; set or clear a user's password.
- **Tag search shortcuts** — typing `#foo` or `tag:foo` filters by tag.