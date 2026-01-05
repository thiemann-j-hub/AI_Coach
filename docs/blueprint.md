# **App Name**: CommsCoach AI

## Core Features:

- Conversation Analysis: Analyze conversation transcripts using the Gemini API to provide coaching feedback, including strengths, improvements, rewrites, and potential risks.
- Contextual Enrichment: Use RAG (Retrieval-Augmented Generation) with Pinecone vector DB to retrieve relevant snippets and guide output for enhanced analysis.
- Dynamic Feedback Generation: Generate tailored coaching feedback based on input text, conversation type, and defined goals, using the LLM as a tool to decide when to incorporate information.
- Real-time Result Display: Display structured feedback (summary, strengths, improvements, rewrites, riskFlags, scores) on the Results View after AI analysis.
- Downloadable Analysis: Allow users to download analysis results as a JSON file.
- Run History: Display a list of recent analysis runs, filtered by browser session to show data including creation date, conversation type, goal, and rating.
- User Rating: Allow users to rate feedback helpfulness (1-5 stars) and persist ratings to Firestore.
- User Rating Persistance: Persist users feedback helpfulness rating (1-5 stars) to Firestore

## Style Guidelines:

- Primary color: Deep teal (#008080) for professionalism and trustworthiness, as requested.
- Background color: Very light grey (#F0F0F0) to keep focus on content, as requested.
- Accent color: Light coral (#F08080) to highlight important calls to action, as requested.
- Body and headline font: 'Inter', a sans-serif font that balances modern clarity with warmth for an accessible user experience, as requested.
- Code font: 'Source Code Pro' for clear presentation of transcript snippets, as requested.
- Use simple, clear icons for each section, e.g., strengths, improvements, rewrites, risks, to offer visual signposts, as requested.
- Use subtle animations to transition between the analysis form and results, as requested.