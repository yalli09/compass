from transformers import AutoModelForCausalLM, AutoTokenizer, TextStreamer
import torch

MODEL_ID = "LiquidAI/LFM2.5-350M"

# Load model + tokenizer (adjust dtype / device_map per your hardware)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    device_map="auto",
    dtype=torch.bfloat16,  # change to torch.float16 or remove if unsupported
    # attn_implementation="flash_attention_2",  # uncomment on compatible GPU
)
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)

# Reusable text streamer (optional; prints generation as it streams)
streamer = TextStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

# System prompt
SYSTEM_PROMPT = """You are a travel assistant that provides concise, practical itineraries, budgets, transport options, packing lists, and booking workflows. Prioritize user goals, safety, and clear actionable steps. Always confirm key constraints (dates, travelers, budget, preferences) before finalizing plans. When suggesting prices or schedules, state assumptions and provide ranges. Offer one recommended itinerary plus 1–2 alternatives. Use short numbered steps for actions (book, check visa, buy insurance). If asked to generate code, return only code blocks. Refuse or escalate requests that involve wrongdoing, fraud, or sharing private credentials.

Assistant behavior rules
Do not rush the user let him tell you and then plan for him
and remember do not do more then the user asks you unless they want you to do it
read what the user is asking not always he want to plan a trip
"""

def query_llm(user_prompt: str, context: str | None = None, stream: bool = True, **gen_kwargs):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if context:
        messages.append({"role": "system", "content": context})
    messages.append({"role": "user", "content": user_prompt})

    prepared = tokenizer.apply_chat_template(
        messages,
        add_generation_prompt=True,
        return_tensors="pt",
        tokenize=True,
    )
    input_ids = prepared["input_ids"].to(model.device)
    attention_mask = prepared.get("attention_mask")
    if attention_mask is not None:
        attention_mask = attention_mask.to(model.device)

    gen_inputs = {"input_ids": input_ids}
    if attention_mask is not None:
        gen_inputs["attention_mask"] = attention_mask

    defaults = dict(
        do_sample=True,
        temperature=0.1,
        top_k=50,
        repetition_penalty=1.05,
        max_new_tokens=512,
    )
    gen_params = {**defaults, **gen_kwargs}

    if stream:
        output = model.generate(**gen_inputs, streamer=streamer, **gen_params)
        generated_ids = output[0][ input_ids.shape[-1] : ]
        return tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
    else:
        output_ids = model.generate(**gen_inputs, **gen_params)
        new_tokens = output_ids[0][ input_ids.shape[-1] : ]
        return tokenizer.decode(new_tokens, skip_special_tokens=True).strip()


# Example usage
if __name__ == "__main__":
    resp = query_llm("how are you", stream=False, temperature=0.5, max_new_tokens=256)
    print(resp)