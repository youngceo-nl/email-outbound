## Human language of this scope
we want to have a section on the source accounts page with suggested seed accounts. 

good seed accounts are 
https://www.instagram.com/pierree/
https://www.instagram.com/kishanslings
@Pierree because he's a friend of brezscales and in correlation follows a lot of infopreneurs
@Kishanslings because he's a sales agency in the info space 
Now, I believe that the sales agency one is better recognizable before apify scrape because of the bio. But nonetheless, this is for a recommended section and is thus subject to human curation. 

so we want to have a function in the app that goes through all the accounts we have and decides which it is going to put on the recommended section. 

### Suggested seed accounts section (Source Accounts page)

**Goal:**
Add a "Recommended" section to the Source Accounts page, populated by a 
function that scans existing accounts and surfaces good seed-account 
candidates for human curation (not auto-added — a human picks from the list).

**What makes a good seed account (examples):**

1. **@pierree** — https://www.instagram.com/pierree/
   - Good because: personal/social connection to an existing known-good 
     seed (brezscales), and his following list correlates heavily with 
     infopreneurs
   - Signal type: network correlation (who they follow overlaps with 
     known-good seeds' followings)

2. **@kishanslings** — https://www.instagram.com/kishanslings
   - Good because: runs a sales agency operating in the info-product space
   - Signal type: bio/profile content (agency type detectable from bio text)
   - Note: this signal is recognizable *before* an Apify scrape even runs, 
     since it's visible from the bio alone — cheaper/earlier signal than 
     network correlation

**Desired behavior:**
- New function that evaluates existing accounts in the system against 
  these signal types (network correlation + bio/profile content) and 
  ranks/flags candidates
- Output surfaces in a "Recommended" section on the Source Accounts page
- This is a suggestion layer only — final decision stays with human curation, 
  nothing gets auto-added as a seed

**Questions:**
- 👉 Where does "accounts we have" come from — is there an existing table/list 
  of all scraped or known accounts to run this function against, or does 
  Claude need to locate it? 👈
- 👉 Should the two signal types (network correlation vs. bio content) be 
  weighted/scored separately and combined, or should Claude propose a 
  scoring approach? 👈
- 👉 Any known accounts that are explicitly NOT good seeds, to use as 
  negative examples? (optional, but helps calibrate the function) 👈 make a fuction where you can mark an account as shit seed, then with an are you sure? And then on the bottom of the page will be a table with only shit seeds (will be used to train the system later)
- 👉 Roughly how many candidates should the Recommended section show at 
  once — top 5? top 10? no cap? 👈 yeah 5 at a time is good