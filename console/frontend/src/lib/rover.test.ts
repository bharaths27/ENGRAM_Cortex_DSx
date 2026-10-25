import { describe, expect, it } from "vitest";

import {
  BRAIN_ID,
  PART_ORDER,
  highlightPartFor,
  partInfo,
  stepInfo,
  armJointNumber,
  displayName,
  groupOf,
  lerp3,
  partDescription,
  partStepState,
} from "./rover";

describe("rover parts", () => {
  it("strips the number and underscores from part names", () => {
    expect(displayName("02_Front_Left_Wheel")).toBe("Front Left Wheel");
    expect(displayName("17_Top_Sensor_Housing")).toBe("Top Sensor Housing");
  });

  it("has 17 parts in build order", () => {
    expect(PART_ORDER).toHaveLength(17);
    expect(PART_ORDER[0]).toBe("01_Chassis_Frame");
    expect(PART_ORDER[16]).toBe("17_Top_Sensor_Housing");
  });

  it("assigns parts to the five groups", () => {
    expect(groupOf("05_Rear_Right_Wheel")?.label).toBe("Base");
    expect(groupOf("07_Top_Protective_Rails")?.label).toBe("Body");
    expect(groupOf("13_Wrist_Joint")?.label).toBe("Arm");
    expect(groupOf("16_Right_Gripper_Finger")?.label).toBe("Hand");
    expect(groupOf("17_Top_Sensor_Housing")?.label).toBe("Sensor");
  });

  it("numbers arm joints in order, pedestal first", () => {
    expect(armJointNumber("08_Arm_Base_Pedestal")).toBe(1);
    expect(armJointNumber("13_Wrist_Joint")).toBe(6);
    expect(partDescription("11_Elbow_Joint")).toBe("Arm joint.");
  });

  it("lerps from assembled (t=0) to exploded (t=1)", () => {
    expect(lerp3([0, 0, 0], [2, 4, 6], 0)).toEqual([0, 0, 0]);
    expect(lerp3([0, 0, 0], [2, 4, 6], 1)).toEqual([2, 4, 6]);
    expect(lerp3([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3]);
  });
});

describe("build steps", () => {
  it("adds the current group, keeps earlier groups and ghosts later ones", () => {
    expect(partStepState(0, 2)).toBe("placed");
    expect(partStepState(2, 2)).toBe("adding");
    expect(partStepState(3, 2)).toBe("ghost");
  });

  it("shows every part placed on the Brain step", () => {
    for (let g = 0; g < 5; g++) expect(partStepState(g, 5)).toBe("placed");
  });
});

describe("info card", () => {
  it("uses the team's text for each part", () => {
    expect(partInfo("01_Chassis_Frame").does).toBe("The base everything mounts onto.");
    expect(partInfo("10_Lower_Arm_Link").does).toBe("Rigid arm segment between two joints.");
    expect(partInfo("15_Left_Gripper_Finger").group).toBe("Hand");
  });

  it("Brain is the Raspberry Pi 5 and lights up the rear enclosure", () => {
    expect(partInfo(BRAIN_ID).title).toBe("Raspberry Pi 5");
    expect(partInfo(BRAIN_ID).group).toBe("Brain");
    expect(highlightPartFor(BRAIN_ID)).toBe("06_Rear_Equipment_Enclosure");
  });

  it("Previous / Next step through parts in number order, then Brain, and wrap", () => {
    expect(stepInfo("01_Chassis_Frame", 1)).toBe("02_Front_Left_Wheel");
    expect(stepInfo("17_Top_Sensor_Housing", 1)).toBe(BRAIN_ID);
    expect(stepInfo(BRAIN_ID, 1)).toBe("01_Chassis_Frame");
    expect(stepInfo("01_Chassis_Frame", -1)).toBe(BRAIN_ID);
  });
});
