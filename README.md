# caligula

> Optimize CSS stylesheets for your Svelte apps.

This library statically analyzes and extracts class selectors from Svelte components using the [svelte compiler](https://svelte.dev/docs#Compile_time). Given an external CSS file, the library outputs an optimized stylesheet by removing unused class rules.

## Motivation

One of the quickest ways to style Svelte applications (or web apps in general) is to define an external CSS stylesheet in the HTML `head` tag.

```html
<!-- index.html -->
<head>
  <link rel="stylesheet" href="https://unpkg.com/uswds@2.6.0/dist/css/uswds.css" />
</head>
```

By design, styles written in Svelte [are scoped to the component](https://svelte.dev/docs#style). While scoped styles improve encapsulation, it is cumbersome to prefix globally applied rules with `:global`.

```html
<!-- App.svelte -->
<script>
  import Accordion from "./Accordion.svelte";
</script>

<style>
  :global(.line-height-heading) {
    line-height: 1.2;
  }

  :global(.font-size-sm) {
    font-size: 0.93rem;
  }
</style>

<Accordion class="line-height-heading font-size-sm" />
```

The problem is that pre-built stylesheets contain far more rules than are actually used. The CSS file for a design system or library can be hundreds of kilobytes, even after minification.

For example, the stylesheet for the [U.S. Web Design System](https://designsystem.digital.gov/) weighs in at **268 kB minified**.

### Against Preprocessors

One solution is to use a preprocessor to import smaller SASS/SCSS partials.

This has two main drawbacks:

- **Extra build configuration**: Using CSS preprocessors involves additional tooling and set-up. This is overkill, especially for rapid prototyping.
- **Still a manual process**: SASS partials must be manually added or removed, which can be inefficient and error prone.

## Getting Started

```bash
yarn add -D caligula
```

## Usage

Install `caligula` as a development dependency.

```bash
yarn add -D caligula
```

In this example, only several class selectors are used from a localy copy of the [U.S. Web Design System](https://unpkg.com/uswds@2.6.0/dist/css/uswds.css) CSS file (unminified).

```js
// postbuild.js
const { caligula } = require("caligula");

caligula({
  include: ["src/**/*.svelte"],
  input: "css/uswds.css",
});
```

### Output

```diff
node postbuild.js

# Detected 7 classes from 2 Svelte components
# Removed 4660 classes from "css/uswds.css"
- Original size: 357.915 kB
+ New size: 10.53 kB

+ > 347.385 kB (97.1%) smaller!
# > Saved output to "css/uswds.8a6dce134044.css"
```

The output file is minified and hashed. Its size is significantly smaller than that of the original.

## API

```js
caligula({
  /**
   * glob of Svelte components
   * @type {Array.<string>}
   */
  include: ["src/**/*.svelte"],

  /**
   * path to the original CSS file
   * @type {string}
   */
  input: "css/uswds.css",

  /**
   * optional output file path
   * @type {string} [output=undefined]
   */
  output: "dist/uswds.min.css",

  /**
   * hash the output file name
   * @type {boolean} [hash=true]
   */
  hash: false,

  /**
   * cssnano minification config options
   * @type {object} [minifyOptions={ from: undefined }]
   */
  minifyOptions: {},

  /**
   * hook triggered after minifying the CSS
   * useful for appending metadata like licenses
   * @param {string} - minified CSS
   * @returns {string} - modified CSS
   */
  onMinify: (css) => `/*! uswds v2.6.0 */${css}`,
});
```

## License

[MIT](LICENSE)
