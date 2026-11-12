import { useId, type ReactNode } from "react";
import { toPounds } from "./currency";
import { currencySymbol } from "./format";
import { AttributeFilters, PLAYER_ATTRIBUTES } from "./AttributeFilters";
import {
  AgeInputs,
  CheckInput,
  ContractEndInput,
  countPersonFilters,
  FilterBar,
  GenderInput,
  NO_PERSON_FILTERS,
  TextInput,
  toPersonFilter,
  type PersonFilterFields,
} from "./FilterBar";
import { playerListText, POSITION_LABELS, type PositionKey } from "./labels";
import type { PlayerFilter } from "./types";

const text = playerListText.filters;

/** The positions in the select, from the goal to the front; their labels are in `POSITION_LABELS`. */
export const POSITION_ORDER: readonly PositionKey[] = [
  "gk", "sw", "dl", "dc", "dr", "wbl", "wbr", "dm", "ml", "mc", "mr", "aml", "amc", "amr", "st",
];

/** What the filter inputs hold, as typed: an empty string, or `false`, is no filter. */
export interface PlayerFilterFields extends PersonFilterFields {
  /** A position key. */
  position: string;
  freeAgents: boolean;
  transferListed: boolean;
  loanListed: boolean;
  maxCurrentAbility: string;
  maxPotentialAbility: string;
  /** Money in the currency shown; the filter asks for pounds, as the game keeps them. */
  minWage: string;
  maxWage: string;
  minAskingPrice: string;
  maxAskingPrice: string;
  minValue: string;
  maxValue: string;
  /** Part of a nation's name whose players are left out. */
  excludeNation: string;
}

export const NO_PLAYER_FILTERS: PlayerFilterFields = {
  ...NO_PERSON_FILTERS,
  position: "",
  freeAgents: false,
  transferListed: false,
  loanListed: false,
  maxCurrentAbility: "",
  maxPotentialAbility: "",
  minWage: "",
  maxWage: "",
  minAskingPrice: "",
  maxAskingPrice: "",
  minValue: "",
  maxValue: "",
  excludeNation: "",
};

/** A whole number from 1 to 200, as an ability; nothing for an empty or unreadable input. */
function ability(input: string): number | undefined {
  const value = Number(input);
  return input.trim() === "" || !Number.isFinite(value) ? undefined : Math.min(200, Math.max(1, Math.round(value)));
}

/** An amount typed in the currency shown, as the pounds the game keeps; nothing for an empty or unreadable input. */
function pounds(input: string): number | undefined {
  const value = Number(input);
  return input.trim() === "" || !Number.isFinite(value) || value < 0
    ? undefined
    : Math.min(2_147_483_647, toPounds(value));
}

/** The filter the inputs ask for, or `undefined` while none is in effect. */
export function toPlayerFilter(fields: PlayerFilterFields): PlayerFilter | undefined {
  const filter: PlayerFilter = {
    ...toPersonFilter(fields),
    position: fields.position || undefined,
    freeAgents: fields.freeAgents || undefined,
    transferListed: fields.transferListed || undefined,
    loanListed: fields.loanListed || undefined,
    maxCurrentAbility: ability(fields.maxCurrentAbility),
    maxPotentialAbility: ability(fields.maxPotentialAbility),
    minWage: pounds(fields.minWage),
    maxWage: pounds(fields.maxWage),
    minAskingPrice: pounds(fields.minAskingPrice),
    maxAskingPrice: pounds(fields.maxAskingPrice),
    minValue: pounds(fields.minValue),
    maxValue: pounds(fields.maxValue),
    excludeNation: fields.excludeNation.trim() || undefined,
  };
  return countFilters(filter) > 0 ? filter : undefined;
}

/** How many filters are in effect; the two ends of the age range count as one, and each attribute bound as one. */
export function countFilters(filter: PlayerFilter | undefined): number {
  if (!filter) {
    return 0;
  }
  // A range counts once, by either of its ends: the person filters count the least CA and PA already.
  const single = [
    filter.position,
    filter.freeAgents,
    filter.transferListed,
    filter.loanListed,
    filter.minCurrentAbility === undefined ? filter.maxCurrentAbility : undefined,
    filter.minPotentialAbility === undefined ? filter.maxPotentialAbility : undefined,
    filter.minWage ?? filter.maxWage,
    filter.minAskingPrice ?? filter.maxAskingPrice,
    filter.minValue ?? filter.maxValue,
    filter.excludeNation,
  ].filter(
    (value) => value !== undefined,
  ).length;
  return single + countPersonFilters(filter);
}

interface PlayerFilterBarProps {
  fields: PlayerFilterFields;
  onChange: (fields: PlayerFilterFields) => void;
  /** How many filters are in effect, from `countFilters`. */
  active: number;
  /** Whether the game's layout tells women from men: only then is there a choice between them. */
  genderKnown: boolean;
  /** More controls after Clear in the head of the bar, e.g. those of the saved filters. */
  actions?: ReactNode;
}

interface RangeEnd {
  value: string;
  onChange: (value: string) => void;
}

/** The amounts money inputs offer to pick, in the currency shown, from ten thousand to five hundred trillion. */
const MONEY_PRESETS = [
  1e4, 1e5, 1e6, 1e7, 5e7, 1e8, 5e8, 1e9, 5e9, 1e10, 5e10, 1e11, 5e11, 1e12, 1e13, 1e14, 5e14,
];

/** Amounts the short way, as FM writes them whatever the currency: "10K", "1M", "5B", "1T". */
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 0 });

/** Two number inputs, the least and the most, under one label; `bounds` for an ability, `wide` for money, which
 * offers the presets to pick from as well as typing. */
function RangeInputs(props: {
  label: string;
  title: string;
  min: RangeEnd;
  max: RangeEnd;
  bounds?: [number, number];
  wide?: boolean;
}) {
  const { label, title, min, max, bounds, wide = false } = props;
  const id = useId();
  const presets = useId();
  const end = (end: RangeEnd, placeholder: string, name: string) => (
    <input
      type="number"
      list={wide ? presets : undefined}
      min={bounds?.[0] ?? 0}
      max={bounds?.[1]}
      step={1}
      placeholder={placeholder}
      aria-label={`${label}: ${name}`}
      value={end.value}
      onChange={(e) => end.onChange(e.currentTarget.value)}
    />
  );
  return (
    <div className={wide ? "filter-field filter-money-range" : "filter-field"} role="group" aria-labelledby={id} title={title}>
      <span id={id}>{label}</span>
      {end(min, text.minPlaceholder, text.minPlaceholder)}
      <span aria-hidden="true">–</span>
      {end(max, text.maxPlaceholder, text.maxPlaceholder)}
      {wide && (
        <datalist id={presets}>
          {MONEY_PRESETS.map((amount) => (
            <option key={amount} value={amount} label={`${currencySymbol} ${compact.format(amount)}`} />
          ))}
        </datalist>
      )}
    </div>
  );
}

/** The filter bar of the player list: a button with the number of filters in effect, and the inputs behind it. */
export function PlayerFilterBar({ fields, onChange, active, genderKnown, actions }: PlayerFilterBarProps) {
  const set = <K extends keyof PlayerFilterFields>(key: K, value: PlayerFilterFields[K]) =>
    onChange({ ...fields, [key]: value });
  const input = <K extends keyof PlayerFilterFields>(key: K) => ({
    value: fields[key],
    onChange: (value: PlayerFilterFields[K]) => set(key, value),
  });

  return (
    <FilterBar active={active} onClear={() => onChange(NO_PLAYER_FILTERS)} actions={actions}>
      <label className="filter-field">
        <span>{text.position}</span>
        <select value={fields.position} onChange={(e) => set("position", e.currentTarget.value)}>
          <option value="">{text.any}</option>
          {POSITION_ORDER.map((key) => (
            <option key={key} value={key}>
              {POSITION_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      {genderKnown && <GenderInput {...input("gender")} />}
      <AgeInputs min={input("minAge")} max={input("maxAge")} />
      <RangeInputs
        label={text.currentAbility}
        title={text.currentAbilityTitle}
        min={input("minCurrentAbility")}
        max={input("maxCurrentAbility")}
        bounds={[1, 200]}
      />
      <RangeInputs
        label={text.potentialAbility}
        title={text.potentialAbilityTitle}
        min={input("minPotentialAbility")}
        max={input("maxPotentialAbility")}
        bounds={[1, 200]}
      />
      <RangeInputs
        label={text.wage(currencySymbol)}
        title={text.wageTitle}
        min={input("minWage")}
        max={input("maxWage")}
        wide
      />
      <RangeInputs
        label={text.transferValue(currencySymbol)}
        title={text.transferValueTitle}
        min={input("minValue")}
        max={input("maxValue")}
        wide
      />
      <RangeInputs
        label={text.askingPrice(currencySymbol)}
        title={text.askingPriceTitle}
        min={input("minAskingPrice")}
        max={input("maxAskingPrice")}
        wide
      />
      <TextInput label={text.nation} {...input("nation")} />
      <TextInput label={text.excludeNation} {...input("excludeNation")} />
      <TextInput label={text.club} {...input("club")} />
      <CheckInput label={text.freeAgentsOnly} {...input("freeAgents")} />
      <ContractEndInput {...input("contractExpiresBy")} />
      <CheckInput label={text.transferListedOnly} {...input("transferListed")} />
      <CheckInput label={text.loanListedOnly} {...input("loanListed")} />
      <AttributeFilters
        rows={fields.attributes}
        choices={PLAYER_ATTRIBUTES}
        onChange={(rows) => set("attributes", rows)}
      />
    </FilterBar>
  );
}
