---
title: Creation of this personal website/blog
lang: en-US
meta:
  - name: description
    content: java
  - name: keywords
    content: backend
  - name: category
    content: personal page
---

# Creation of this personal website/blog

I have always wanted to share a public journal of things I find interesting and things I have learned for other people to enjoy. I also wanted to explore a little bit of my creative side and get into the habit of writing articles and blogs. I delayed a lot and finally after a lot of procrastination I have set this website up.


My initial website setup was a kubernetes cluster with ingress and lets encrypt setup with cloudflare acting as the dns provider and cdn along with mongo cloud's managed mongo server. So whenever I made any small change to my git repo, I had to manually tag and make an a docker image to use in my kubernetes deployment. Adding in automated CI/CD would have needed more effort on my part for something so trivial and adding to more costs, so I stuck with the manual route of updating my deployments.

It was becoming really cumbersome to make any small changes so I thought of just revamping my whole setup and making it as frictionless as possible without feeling like I have lost control over the setup. 

To achieve my goal, my current setup is very simple. It was just a one time setup with almost free plans. 

### Current architecture
---
Browser (HTTPS) -> Cloudflare -> (HTTPS) NETLIFY static vuepress page

### Deployment Setup (Frictionless)
---
Open Gitpod (Online IDE) -> Write in Markdown and have control over fine tuning using javascript if wanted(Vue Press) -> Push changes to Git Repo -> Automated build of static pages on netlify to serve to the web

And the best part is that I can do all of this online without having to install a single piece of software offline. I wanted to switch to an online IDE and experience its convenience and ease of use.

Finally I have achieved what I have wanted. Frictionless online update of website and blog without losing the control of either the backend or the frontend (Vue Press gives me power to either write a blog using simple markdown or use javascript to do something fancy, which is actually very incredible ).

Now all I hope is to get some consistency and discipline into writing a few blogs a week


[Home](/)