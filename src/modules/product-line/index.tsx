import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, SkeletonRows } from '@/shared';
import {
  fetchRetailSkuCosts,
  type RetailIngredient,
  type RetailSkuCost,
  type RetailSkuCostsResult,
} from '@/modules/data-ingestion/warehouseReadClient';
import {
  commitRetailIngredient,
  commitRetailRecipeItem,
  commitRetailSku,
  removeRetailIngredient,
  removeRetailRecipeItem,
  type WarehouseWriteResult,
} from '@/modules/data-ingestion/warehouseWriteClient';

const INPUT_CLASSES =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

function ResultLine({ result }: { result: WarehouseWriteResult }) {
  return (
    <p className={`mt-2 text-xs ${result.ok ? 'text-[var(--color-ink)]' : 'text-[var(--color-critical)]'}`}>
      {result.ok ? (result.note ?? 'Saved.') : (result.error ?? 'Something went wrong.')}
    </p>
  );
}

/** Add-ingredient form — cost per base unit is never typed in, it's derived from what was actually paid (purchase_price / purchase_quantity) so it stays real if a supplier's price changes. */
function AddIngredientForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseQuantity, setPurchaseQuantity] = useState('');
  const [unit, setUnit] = useState('ml');
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const priceNum = Number(purchasePrice);
  const qtyNum = Number(purchaseQuantity);
  const canSubmit =
    name.trim() !== '' && purchasePrice !== '' && Number.isFinite(priceNum) && priceNum >= 0 && purchaseQuantity !== '' && Number.isFinite(qtyNum) && qtyNum > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitRetailIngredient({ name: name.trim(), purchasePrice: priceNum, purchaseQuantity: qtyNum, unit: unit.trim() || 'each' });
      setResult(res);
      if (res.ok) {
        setName('');
        setPurchasePrice('');
        setPurchaseQuantity('');
        onSaved();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Ingredient / component name</label>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Argan oil base" className={INPUT_CLASSES} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Paid (£)</label>
          <input type="number" min="0" step="0.01" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">For how much</label>
          <input type="number" min="0" step="0.01" value={purchaseQuantity} onChange={(event) => setPurchaseQuantity(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Unit</label>
          <select value={unit} onChange={(event) => setUnit(event.target.value)} className={INPUT_CLASSES}>
            <option value="ml">ml</option>
            <option value="g">g</option>
            <option value="each">each</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">
        e.g. "Paid £40 for 1000 ml" — cost per ml is worked out automatically, and stays correct if the price changes later.
      </p>
      <Button type="submit" disabled={!canSubmit || isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Add ingredient'}
      </Button>
      {result && <ResultLine result={result} />}
    </form>
  );
}

function IngredientRow({ ingredient, onRemoved }: { ingredient: RetailIngredient; onRemoved: () => void }) {
  const [isRemoving, setIsRemoving] = useState(false);

  async function handleRemove() {
    setIsRemoving(true);
    try {
      const res = await removeRetailIngredient({ id: ingredient.id });
      if (res.ok) onRemoved();
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <tr className="border-b border-[var(--color-border)] last:border-b-0">
      <td className="px-4 py-2 font-medium text-[var(--color-ink)]">{ingredient.name}</td>
      <td className="px-3 py-2 tabular-nums text-[var(--color-ink-secondary)]">
        {currency.format(ingredient.purchasePrice)} / {ingredient.purchaseQuantity}
        {ingredient.unit}
      </td>
      <td className="px-3 py-2 tabular-nums text-[var(--color-ink)]">
        {currency.format(ingredient.costPerBaseUnit)}/{ingredient.unit}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => void handleRemove()}
          disabled={isRemoving}
          className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-critical)]"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

/** Add-SKU form — real selling prices are optional, so a product can exist and show a production cost before pricing is settled. */
function AddSkuForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inSalonPrice, setInSalonPrice] = useState('');
  const [onlinePrice, setOnlinePrice] = useState('');
  const [shippingPackagingCost, setShippingPackagingCost] = useState('');
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = name.trim() !== '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitRetailSku({
        name: name.trim(),
        description: description.trim() || null,
        inSalonPrice: inSalonPrice !== '' ? Number(inSalonPrice) : null,
        onlinePrice: onlinePrice !== '' ? Number(onlinePrice) : null,
        shippingPackagingCost: shippingPackagingCost !== '' ? Number(shippingPackagingCost) : null,
      });
      setResult(res);
      if (res.ok) {
        setName('');
        setDescription('');
        setInSalonPrice('');
        setOnlinePrice('');
        setShippingPackagingCost('');
        onSaved();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Product name</label>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Glass Blonde Hair Serum" className={INPUT_CLASSES} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Description (optional)</label>
        <input value={description} onChange={(event) => setDescription(event.target.value)} className={INPUT_CLASSES} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">In-salon price (£)</label>
          <input type="number" min="0" step="0.01" value={inSalonPrice} onChange={(event) => setInSalonPrice(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Online price (£)</label>
          <input type="number" min="0" step="0.01" value={onlinePrice} onChange={(event) => setOnlinePrice(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Postage + packaging (£)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={shippingPackagingCost}
            onChange={(event) => setShippingPackagingCost(event.target.value)}
            className={INPUT_CLASSES}
          />
        </div>
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">
        Postage/packaging only ever applies to the online price — an in-salon sale never gets posted.
      </p>
      <Button type="submit" disabled={!canSubmit || isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Add product'}
      </Button>
      {result && <ResultLine result={result} />}
    </form>
  );
}

function RecipeBuilder({ sku, ingredients, onChanged }: { sku: RetailSkuCost; ingredients: RetailIngredient[]; onChanged: () => void }) {
  const usedIds = new Set(sku.recipe.map((r) => r.ingredientId));
  const available = ingredients.filter((i) => !usedIds.has(i.id));
  const [ingredientId, setIngredientId] = useState(available[0]?.id ?? '');
  const [quantityUsed, setQuantityUsed] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const qtyNum = Number(quantityUsed);
  const canAdd = ingredientId !== '' && quantityUsed !== '' && Number.isFinite(qtyNum) && qtyNum > 0;

  async function handleAdd() {
    if (!canAdd) return;
    setIsSubmitting(true);
    try {
      const res = await commitRetailRecipeItem({ skuId: sku.skuId, ingredientId, quantityUsed: qtyNum });
      if (res.ok) {
        setQuantityUsed('');
        onChanged();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemoveLine(recipeItemId: string) {
    const res = await removeRetailRecipeItem({ id: recipeItemId });
    if (res.ok) onChanged();
  }

  const selectedIngredient = ingredients.find((i) => i.id === ingredientId);

  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Recipe</p>
      {sku.recipe.length > 0 && (
        <ul className="mb-3 space-y-1">
          {sku.recipe.map((line) => (
            <li key={line.recipeItemId} className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-ink-secondary)]">
                {line.quantityUsed}
                {line.unit} {line.ingredientName}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-[var(--color-ink)]">{currency.format(line.lineCost)}</span>
                <button type="button" onClick={() => void handleRemoveLine(line.recipeItemId)} className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-critical)]">
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Ingredient</label>
            <select value={ingredientId} onChange={(event) => setIngredientId(event.target.value)} className={INPUT_CLASSES}>
              {available.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Qty{selectedIngredient ? ` (${selectedIngredient.unit})` : ''}</label>
            <input type="number" min="0" step="0.01" value={quantityUsed} onChange={(event) => setQuantityUsed(event.target.value)} className={INPUT_CLASSES} />
          </div>
          <Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" disabled={!canAdd || isSubmitting} onClick={() => void handleAdd()}>
            Add
          </Button>
        </div>
      ) : (
        <p className="text-xs text-[var(--color-ink-muted)]">Every ingredient on file is already in this recipe.</p>
      )}
    </div>
  );
}

function SkuCard({ sku, ingredients, onChanged }: { sku: RetailSkuCost; ingredients: RetailIngredient[]; onChanged: () => void }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">{sku.name}</h3>
      {sku.description && <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{sku.description}</p>}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">Production cost/unit</p>
          <p className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">{currency.format(sku.productionCostPerUnit)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">Online landed cost/unit</p>
          <p className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">{currency.format(sku.onlineCostPerUnit)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">In-salon margin</p>
          <p className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">
            {sku.inSalonMargin === null ? '—' : `${currency.format(sku.inSalonMargin)} (${pct(sku.inSalonMarginPct)})`}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">Online margin</p>
          <p className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">
            {sku.onlineMargin === null ? '—' : `${currency.format(sku.onlineMargin)} (${pct(sku.onlineMarginPct)})`}
          </p>
        </div>
      </div>

      <RecipeBuilder sku={sku} ingredients={ingredients} onChanged={onChanged} />
    </Card>
  );
}

/**
 * MedLocks retail product line (added 5 Sep 2026) — a genuinely separate
 * business function from the salon-services app (manufacturing + retail,
 * not stylists/appointments). Deliberately not in the main 7-tab nav,
 * same reasoning and pattern as Stock/Pricing — reachable via a link from
 * Settings. Cost per unit is never a number typed in: it's a live
 * computation from real ingredient purchase prices and recipe
 * quantities, so it stays correct automatically as real costs change.
 */
export function ProductLinePage() {
  const [result, setResult] = useState<RetailSkuCostsResult | null>(null);

  function load() {
    fetchRetailSkuCosts().then(setResult);
  }

  useEffect(() => {
    let cancelled = false;
    fetchRetailSkuCosts().then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const skus = result?.skus ?? [];
  const ingredients = result?.ingredients ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <Link to="/settings" className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-ink)]">Product line</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          MedLocks' own manufactured product line — real cost per unit, computed from what ingredients actually cost
          and how much of each a product's recipe uses. Change an ingredient's price and every product using it
          recomputes automatically.
        </p>
      </header>

      {result === null && <SkeletonRows count={3} />}
      {result && !result.ok && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">{result.error}</p>
        </Card>
      )}

      {result?.ok && (
        <>
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">Ingredients</h2>
            <Card className="mb-3">
              <AddIngredientForm onSaved={load} />
            </Card>
            {ingredients.length > 0 && (
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-ink-muted)]">
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Bought as</th>
                      <th className="px-3 py-2 font-medium">Cost per unit</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingredients.map((ing) => (
                      <IngredientRow key={ing.id} ingredient={ing} onRemoved={load} />
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">Products</h2>
            <Card className="mb-3">
              <AddSkuForm onSaved={load} />
            </Card>
            {skus.length === 0 && ingredients.length === 0 && (
              <Card>
                <p className="text-sm text-[var(--color-ink-secondary)]">
                  Add your real ingredients above first, then add a product and build its recipe from them.
                </p>
              </Card>
            )}
            <div className="space-y-3">
              {skus.map((sku) => (
                <SkuCard key={sku.skuId} sku={sku} ingredients={ingredients} onChanged={load} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
