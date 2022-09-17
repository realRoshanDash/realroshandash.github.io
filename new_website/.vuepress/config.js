module.exports = {
    head: [
        [
            'link', {
                rel: 'icon',
                href: '/assets/img/logo.png'
            }
        ],
      ['script', {
          async: true,
          src: 'https://easystartup.io/js/script.js',
          'data-api':"https://analytics.easystartup.io",
          'data-id':"62123104b47eee4041c48c91"
      }],
    ],
    markdown: {
        lineNumbers: false // Code block displays line numbers
    },
    nav: [
      { text: "Blogs", link: "/blog/" },
    ],
    title: "Roshan Dash",
    description: 'A personal website which includes technology, software, motivation, productivity and everything else.',
    port: 8083
}
