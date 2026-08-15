# Testing Notes

## Live browser verification

The initial page rendered successfully in the project preview with the URL input and extraction action visible. The supplied compatible DramaBox/DramaFren detail URL was accepted into the form and the extraction action became enabled. The next test step is to submit it and verify detected episode progress plus the completed browser download.

The submitted form immediately showed the intended in-progress state, including a disabled extraction action, a detecting-episodes message, and the progress bar. The server request had not completed by the first follow-up page check, so server logs will be reviewed before confirming the incremental episode count.

The protected server session detected all 60 episodes and the browser UI advanced through collection as intended. A later live check confirmed the progress indicator at 27 / 60, with its gold progress bar and the extraction action still safely disabled.

Subsequent live checks confirmed continued processing at 46 / 60 and then 59 / 60. The progress counter and bar remained synchronized with the server-side per-episode collection.

The extraction completed for all 60 episodes. The interface transitioned to the workbook-ready confirmation and displayed the direct Excel download action; activating that control completed the browser download trigger without an intermediate page or manual export step.

The updated interface rendered the iDrama-specific guidance and accepted the supplied iDrama watch URL in the live form, enabling the extraction action. The next verification step is to submit the URL and confirm detected episodes plus workbook completion.

The live iDrama submission entered the intended detecting-episodes state. The first follow-up check remained in preparation while the protected browser session completed its page verification, so the server state will be checked before the next progress observation.

The initial live iDrama run reached the adapter but failed while waiting for the first episode page to expose its HLS player script. The failure is isolated to per-episode page loading; the adapter will be revised to retain the already loaded first-episode page and to emit diagnostic context for any later blocked episode page.

After the adapter revision, the refreshed live interface again accepted the same iDrama watch URL and enabled extraction. The corrected run will retain the initially loaded page for episode 1 before requesting later episode pages.

The iDrama adapter’s parsing and first-episode live smoke extraction succeeded when its protected session loaded the page. However, repeat server-side sessions can remain on the iDrama Cloudflare verification page for the full 120-second readiness window. The feature is therefore not yet reliable enough to advertise as fully supported in the hosted extractor.

The approved beta update visibly labels DramaBox as stable and iDrama as beta in the shared interface. The automated test suite validates iDrama HLS-source parsing and the verification-page retry message, while the existing DramaBox end-to-end workbook flow remains verified.

The updated browser interface clearly displays the stable/beta distinction and accepts the supplied iDrama watch URL for the beta extraction path. The final browser check will submit that input and inspect the verification-blocked response.

The submitted iDrama beta watch URL completed successfully in the live interface and reached the workbook-ready state with a direct Excel download action. This confirms the beta path can complete when the source-site verification allows the protected session through; the UI continues to present the retry guidance for intermittent verification blocks. The unchanged DramaBox branch remains covered by the full test suite and its previously verified end-to-end workbook workflow.

After the beta update, the live interface again accepted the original DramaBox detail URL and enabled extraction. The final regression check will confirm the 60-episode stable workflow completes normally.

The post-beta DramaBox regression completed successfully and reached the workbook-ready state with the direct download action, confirming the stable 60-episode workflow remains intact. The iDrama beta path also completed a live workbook run; its explicit verification-blocked retry message remains covered by automated tests because the latest live session passed source-site verification.
