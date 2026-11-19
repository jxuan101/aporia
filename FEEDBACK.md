Things to fix:
- [x] Clicking process with AI spams the backend with ```"GET /api/v1/agent/jobs/dc2bc119-6948-4b17-8c67-d343dffb0ec5 HTTP/1.1" 200 OK``` but nothing actually happens. It shouldn't keep retrying if access to AI is unavailable.
- [x] The Items, Export, Sign Out buttons should probably be placed in a sandwich bar modal.
- [x] When trying to edit stuff in the inbox, the phone's popup keyboard blocks the text so the user can't see anything.
- [x] Braindump shouldn't be included in the header when the Items page is open.
- [x] The app needs more debugging messages in the logs so I know what errors we're running into especially on the backend.
- [x] The Daily Review page should not have the Braindump title in the header as well.
- [x] Clicking a task in the items page leads to an unmatched route page.
- [x] The items in the inbox should not be editable by default.
- [x] Are the AI suggestions suppose to be so simple? For example, when I put "I need to learn to sing", the suggestion is basically "Learn to sing."
- [ ] Editing a capture should either push up the viewport with the keyboard and the capture text is in focus OR make a popup modal appear.
- [ ] Delete should just be a red 'X' button on the top right of the capture container.
- [ ] "Search results" should be "Search Results" and the count of captures and saved items should be below the "Search Results" text so it fits within the viewport.

