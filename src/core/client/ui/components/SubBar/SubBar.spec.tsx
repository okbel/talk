import React from "react";
import { createRenderer } from "react-test-renderer/shallow";

import { PropTypesOf } from "talk-framework/types";

import SubBar from "./SubBar";

it("renders correctly", () => {
  const props: PropTypesOf<typeof SubBar> = {
    children: "child",
    gutterBegin: true,
    gutterEnd: true,
    className: "custom",
  };
  const renderer = createRenderer();
  renderer.render(<SubBar {...props} />);
  expect(renderer.getRenderOutput()).toMatchSnapshot();
});