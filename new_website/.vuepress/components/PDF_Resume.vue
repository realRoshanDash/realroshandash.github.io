<template>
  <div>
    Yolo
    <pdf src="./assets/pdf/Roshan_Dash_Resume.pdf">wow</pdf>
  </div>
  
</template>
<script>
import pdf from 'vue-pdf';
export default {
    data () {
    return {
    }
  },
 components: {
    pdf
  }
}
</script>
<style scoped>
  .article {
    margin-bottom: 20px;
    border-left: solid 5px #3eaf7c;
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