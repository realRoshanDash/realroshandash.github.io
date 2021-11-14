<template>
  <div>
    <div class="article" v-for="page in files">
      <a v-bind:href="page.path">{{ page.title }}</a>
      <div class="keywords">
        <span class="keyword" v-for="key in page.frontmatter.meta">{{
          key.content
        }}</span>
      </div>
    </div>
  </div>
</template>
<script>
export default {
  computed: {
    files() {
      return this.$site.pages
        .filter((p) => {
          return p.path !== "/blog/" && p.path.indexOf("/blog/") >= 0;
        })
        .sort((a, b) => {
          console.log(a.path < b.path);
          return a.path < b.path;
        });
    },
  },
};
</script>
<style scoped>
.article {
  font-size: 1.2rem;
  margin-bottom: 20px;
  border-left: solid 1px #3eaf7c;
  padding: 20px;
}
.keywords {
  margin-top: 10px;
}
.keyword {
  padding: 5px;
  border-radius: 7px;
  font-size: small;
  background: #3eaf7c;
  margin-right: 5px;
  color: white;
  font-weight: 500;
}
</style>
